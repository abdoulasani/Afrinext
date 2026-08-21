-- Phase 3: refund execution.
--
-- Phase 2 left `refund_due` as a queue meaning "payment confirmed, Afrinext did
-- not fulfil, a refund is owed". Nothing executed one. This migration is the
-- machinery that does.
--
-- The whole shape follows from one financial rule:
--
--     UNKNOWN MUST NEVER BECOME FAILED.
--
-- A refund request that timed out, lost its connection, or came back with an
-- HTTP 5xx after the bytes left this process is not evidence that no money
-- moved. Those become `in_doubt`, which is a first-class state that can be
-- resolved but NEVER retried. Only a failure we can prove never reached the
-- provider, or a documented business rejection with evidence, becomes `failed`
-- — and `failed` is the only state a retry may leave from.
--
-- Nothing here posts to the ledger. Phase 2 posts no capture, so a refund
-- reversal would have nothing to reverse and would make the books less true,
-- not more. Ledger treatment belongs to Settlement.

-- ---------------------------------------------------------------------------
-- refunds — one row per owed refund, holding the frozen money
-- ---------------------------------------------------------------------------

CREATE TABLE refunds (
  id                    uuid PRIMARY KEY,
  order_id              uuid NOT NULL REFERENCES orders(id),
  -- UNIQUE below. One payment can only ever have one refund, and that index is
  -- the outermost layer of the double-refund defence: whatever races, whatever
  -- crashes, a second refund row for a payment cannot exist.
  payment_id            uuid NOT NULL REFERENCES payments(id),
  provider              text NOT NULL,

  -- owed | in_flight | succeeded | failed | in_doubt
  status                text NOT NULL DEFAULT 'owed',

  -- Copied from the payment at creation and never recomputed. bigint minor
  -- units with the currency beside them: XOF has zero decimals, so nothing in
  -- the refund path is permitted to divide by anything.
  amount_minor          bigint NOT NULL,
  currency              char(3) NOT NULL REFERENCES currencies(code),

  -- Why a refund is owed, copied from the late-payment decision that produced
  -- `refund_due` (grace_window_elapsed, already_owned, ...).
  reason                text NOT NULL,

  attempt_count         integer NOT NULL DEFAULT 0,

  -- The provider's own identifier for the refund, once anything credible says
  -- what it is. A succeeded refund must have one — including a manually
  -- reconciled one, where the operator supplies the reference from the
  -- provider's statement.
  provider_refund_ref   text,

  -- response | status_query | webhook | manual_reconciliation
  -- How we came to believe the outcome. Manual reconciliation is a distinct
  -- value precisely so it can be singled out and re-audited.
  resolved_by           text,
  -- What we believe it on. Required for `succeeded` AND for `failed`: claiming
  -- a refund definitely did not happen needs evidence exactly as much as
  -- claiming it did.
  resolution_evidence   text,

  -- Retry backoff gate. A retry before this instant is refused.
  not_before            timestamptz,

  -- The finance user who authorised money leaving. NULL while merely owed:
  -- recording a debt is automatic, paying it is not.
  requested_by_user_id  uuid REFERENCES users(id),

  -- Manual reconciliation, two-person where the deployment can support it.
  reconciled_by_user_id           uuid REFERENCES users(id),
  reconciled_confirmed_by_user_id uuid REFERENCES users(id),
  -- two_person | single_operator — recorded so a single-operator resolution is
  -- countable rather than merely absent.
  reconciliation_mode             text,

  -- A manual reconciliation in two steps: one person states what a provider
  -- statement says, a different person confirms it before the refund moves.
  -- The proposal lives here rather than in its own table because it is a
  -- property of this refund and is superseded, never accumulated.
  proposed_outcome                text,
  proposed_evidence               text,
  proposed_provider_refund_ref    text,
  proposed_at                     timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz,

  CONSTRAINT refunds_status_valid
    CHECK (status IN ('owed', 'in_flight', 'succeeded', 'failed', 'in_doubt')),
  CONSTRAINT refunds_amount_positive CHECK (amount_minor > 0),

  -- A refund that says money went back must say how it knows, and name the
  -- reference the provider knows it by. Three columns, all or nothing.
  CONSTRAINT refunds_succeeded_has_evidence CHECK (
    status <> 'succeeded' OR (
      resolved_by IS NOT NULL AND resolution_evidence IS NOT NULL
      AND provider_refund_ref IS NOT NULL AND resolved_at IS NOT NULL
    )
  ),

  -- And a refund that says money definitely did NOT go back must say how it
  -- knows that too. This is the constraint that makes "unknown must never
  -- become failed" a property of the database rather than of a code path.
  CONSTRAINT refunds_failed_has_evidence CHECK (
    status <> 'failed' OR (resolved_by IS NOT NULL AND resolution_evidence IS NOT NULL)
  ),

  CONSTRAINT refunds_resolved_by_valid CHECK (
    resolved_by IS NULL
    OR resolved_by IN ('response', 'status_query', 'webhook', 'manual_reconciliation')
  ),
  -- A proposal may only ever name an outcome a human could have read off a
  -- provider statement. "in_doubt" is not a thing anyone reconciles TO.
  CONSTRAINT refunds_proposed_outcome_valid CHECK (
    proposed_outcome IS NULL OR proposed_outcome IN ('succeeded', 'failed')
  ),
  -- A proposal is a complete statement or it is not a proposal.
  CONSTRAINT refunds_proposal_is_complete CHECK (
    proposed_outcome IS NULL
    OR (proposed_evidence IS NOT NULL AND proposed_at IS NOT NULL
        AND reconciled_by_user_id IS NOT NULL)
  ),
  -- Claiming a refund succeeded means naming the reference it succeeded under.
  CONSTRAINT refunds_proposed_success_has_ref CHECK (
    proposed_outcome <> 'succeeded' OR proposed_provider_refund_ref IS NOT NULL
  ),
  CONSTRAINT refunds_reconciliation_mode_valid CHECK (
    reconciliation_mode IS NULL OR reconciliation_mode IN ('two_person', 'single_operator')
  ),
  -- A two-person reconciliation means two DIFFERENT people. Enforced here so
  -- no code path can record a self-confirmation as if it were dual control.
  CONSTRAINT refunds_two_person_is_two_people CHECK (
    reconciliation_mode <> 'two_person'
    OR (
      reconciled_by_user_id IS NOT NULL
      AND reconciled_confirmed_by_user_id IS NOT NULL
      AND reconciled_by_user_id <> reconciled_confirmed_by_user_id
    )
  ),
  -- Manual reconciliation is the only thing that may name reconcilers: either a
  -- proposal is standing, or one was completed.
  CONSTRAINT refunds_reconcilers_only_when_manual CHECK (
    (reconciled_by_user_id IS NULL AND reconciled_confirmed_by_user_id IS NULL)
    OR proposed_outcome IS NOT NULL
    OR resolved_by = 'manual_reconciliation'
    OR reconciliation_mode IS NOT NULL
  ),
  -- Nobody confirms a proposal that does not exist.
  CONSTRAINT refunds_confirmer_needs_a_proposer CHECK (
    reconciled_confirmed_by_user_id IS NULL OR reconciled_by_user_id IS NOT NULL
  )
);

-- The double-refund defence, outermost layer.
CREATE UNIQUE INDEX refunds_payment_key ON refunds (payment_id);
CREATE UNIQUE INDEX refunds_order_key ON refunds (order_id);
CREATE INDEX refunds_queue_idx ON refunds (status, created_at);
CREATE INDEX refunds_retry_idx ON refunds (status, not_before)
  WHERE status IN ('failed', 'in_flight', 'in_doubt');
CREATE UNIQUE INDEX refunds_provider_ref_key ON refunds (provider, provider_refund_ref)
  WHERE provider_refund_ref IS NOT NULL;

COMMENT ON COLUMN refunds.status IS
  'owed | in_flight | succeeded | failed | in_doubt. in_doubt means the outcome '
  'is unknown; it may be resolved but never retried, because retrying an unknown '
  'is how a buyer gets refunded twice.';

-- The frozen snapshot is frozen by the DATABASE, not by convention.
--
-- amount_minor, currency, payment_id, order_id and provider are copied from the
-- payment at creation and answer the question "how much goes back, to whose
-- charge?". Everything else on the row is a lifecycle that legitimately moves.
-- Leaving the snapshot merely un-updated-by-our-code would make it exactly as
-- immutable as the next person's UPDATE, and reconciliation would be the first
-- thing to notice — after the money had already gone.
CREATE OR REPLACE FUNCTION refunds_snapshot_is_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_minor <> OLD.amount_minor
     OR NEW.currency   <> OLD.currency
     OR NEW.payment_id <> OLD.payment_id
     OR NEW.order_id   <> OLD.order_id
     OR NEW.provider   <> OLD.provider THEN
    RAISE EXCEPTION
      'refund % has a frozen money snapshot: amount, currency, payment, order and '
      'provider may never be changed', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refunds_snapshot_frozen
  BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_snapshot_is_frozen();

-- A refund is evidence of a debt. It is resolved, never erased.
CREATE OR REPLACE FUNCTION refunds_never_deleted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'refunds are never deleted: a refund is resolved, not erased'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER refunds_no_delete
  BEFORE DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_never_deleted();

REVOKE DELETE ON refunds FROM afrinext_app;

-- ---------------------------------------------------------------------------
-- refund_attempts — append-only evidence, written BEFORE the provider call
-- ---------------------------------------------------------------------------
--
-- The row exists before the request leaves this process. That ordering is the
-- crash window's only defence: if the process dies between the insert and the
-- response, an open attempt row is what tells the next operator that a request
-- may be in flight. Writing it afterwards would leave a crash indistinguishable
-- from a refund that was never attempted.

CREATE TABLE refund_attempts (
  id                  uuid PRIMARY KEY,
  refund_id           uuid NOT NULL REFERENCES refunds(id),
  attempt_no          integer NOT NULL,

  -- Derived, never supplied: refund:{refund_id}:{attempt_no}. A caller has no
  -- say in it, so no caller can make two different refunds look like one, or
  -- one refund look like two.
  idempotency_key     text NOT NULL,

  -- Who authorised this attempt. NULL for a scheduler retry of an attempt a
  -- human already authorised.
  actor_user_id       uuid REFERENCES users(id),
  actor_kind          text NOT NULL DEFAULT 'user',

  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,

  -- succeeded | failed | in_doubt | pending. NULL means still open — which,
  -- past the stuck threshold, is itself a finding.
  outcome             text,
  -- not_transmitted | transmitted | unknown. THIS is what decides failed vs
  -- in_doubt, not the HTTP status.
  stage               text,
  provider_refund_ref text,
  -- Screened and truncated. Provider responses are not trusted to be free of
  -- credentials, so nothing is stored raw and nothing is stored long.
  detail              text,

  CONSTRAINT refund_attempts_no_positive CHECK (attempt_no >= 1),
  CONSTRAINT refund_attempts_outcome_valid CHECK (
    outcome IS NULL OR outcome IN ('succeeded', 'failed', 'in_doubt', 'pending')
  ),
  CONSTRAINT refund_attempts_stage_valid CHECK (
    stage IS NULL OR stage IN ('not_transmitted', 'transmitted', 'unknown')
  ),
  -- A finished attempt says what happened and how far it got.
  CONSTRAINT refund_attempts_finished_is_classified CHECK (
    finished_at IS NULL OR (outcome IS NOT NULL AND stage IS NOT NULL)
  ),
  -- The rule again, one layer down: an attempt that did not get the request out
  -- of this process is the ONLY kind that may be recorded as a plain failure.
  CONSTRAINT refund_attempts_failed_means_not_transmitted CHECK (
    outcome <> 'failed' OR stage = 'not_transmitted' OR detail IS NOT NULL
  )
);

CREATE UNIQUE INDEX refund_attempts_no_key ON refund_attempts (refund_id, attempt_no);
CREATE UNIQUE INDEX refund_attempts_idempotency_key ON refund_attempts (idempotency_key);
CREATE INDEX refund_attempts_open_idx ON refund_attempts (started_at)
  WHERE finished_at IS NULL;

-- Append-only, with exactly one permitted mutation: closing an open attempt.
--
-- Not `reject_mutation()`, because an attempt genuinely has two moments — it
-- starts, then it finishes. What must be impossible is rewriting history: a
-- finished attempt is frozen, and no attempt may ever be deleted.
CREATE OR REPLACE FUNCTION refund_attempts_close_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refund_attempts is append-only: a refund attempt may never be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.finished_at IS NOT NULL THEN
    RAISE EXCEPTION
      'refund attempt % is already finished and cannot be rewritten', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.refund_id <> OLD.refund_id
     OR NEW.attempt_no <> OLD.attempt_no
     OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.started_at <> OLD.started_at THEN
    RAISE EXCEPTION
      'refund attempt % may only be closed, not re-identified', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER refund_attempts_append_only
  BEFORE UPDATE OR DELETE ON refund_attempts
  FOR EACH ROW EXECUTE FUNCTION refund_attempts_close_only();

REVOKE DELETE ON refund_attempts FROM afrinext_app;

-- ---------------------------------------------------------------------------
-- Refund webhooks reuse the existing replay defence
-- ---------------------------------------------------------------------------
--
-- payment_events already has UNIQUE (provider, provider_event_id), which is
-- what makes a replayed webhook a no-op at the database. A refund webhook is
-- not a second, weaker door: it goes through the same table and the same index.

ALTER TABLE payment_events ADD COLUMN refund_id uuid REFERENCES refunds(id);
ALTER TABLE payment_events ADD COLUMN subject text NOT NULL DEFAULT 'charge';
ALTER TABLE payment_events ADD CONSTRAINT payment_events_subject_valid
  CHECK (subject IN ('charge', 'refund'));

CREATE INDEX payment_events_refund_idx ON payment_events (refund_id, received_at)
  WHERE refund_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- notification_outbox — provider-neutral, and deliberately unconnected
-- ---------------------------------------------------------------------------
--
-- No SMS provider has been chosen for Niger and none is invented here. What a
-- refund produces is a ROW saying a person should be told something. Delivery
-- is a separate consumer that does not exist yet, which is why `status` starts
-- at 'pending' and nothing in this phase moves it.

CREATE TABLE notification_outbox (
  id                uuid PRIMARY KEY,
  kind              text NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES users(id),
  subject_type      text NOT NULL,
  subject_id        uuid NOT NULL,
  -- Never a message body, never a credential, never an amount formatted for
  -- display: the facts a renderer needs, and nothing a log should not hold.
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'pending',
  attempts          integer NOT NULL DEFAULT 0,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,

  CONSTRAINT notification_outbox_status_valid
    CHECK (status IN ('pending', 'sent', 'failed', 'abandoned')),
  CONSTRAINT notification_outbox_sent_has_timestamp
    CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);

-- One notification per event per subject. A retried resolution does not
-- produce a second message to the same person about the same thing.
CREATE UNIQUE INDEX notification_outbox_event_key
  ON notification_outbox (kind, subject_type, subject_id);
CREATE INDEX notification_outbox_pending_idx ON notification_outbox (status, created_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
--
-- Three, not one. Reading the queue is a support capability; executing a refund
-- moves money; reconciling manually asserts a fact about money that no API
-- confirmed. They are separable because they should be separated.

INSERT INTO permissions (key, description) VALUES
  ('refund.read',             'View the refund queue and refund history'),
  ('refund.execute',          'Authorise and execute a refund through the provider'),
  ('refund.reconcile_manual', 'Resolve a refund of unknown outcome from external evidence')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM roles r CROSS JOIN (VALUES
  ('refund.read'), ('refund.execute'), ('refund.reconcile_manual')
) AS p(key)
WHERE r.key = 'finance'
ON CONFLICT DO NOTHING;

-- Support sees the queue and can answer a buyer asking where their money is.
-- It cannot execute and cannot reconcile: reading is not touching.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'refund.read' FROM roles r WHERE r.key = 'support'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Retry policy — configuration, clamped so it can only ever be gentler
-- ---------------------------------------------------------------------------
--
-- The clamp direction is the point. Every one of these settings is read as a
-- CEILING on aggression: an operator may make retries rarer or fewer without
-- asking anyone, and cannot make them more frequent or more numerous than the
-- reviewed policy by editing a row. A malformed value falls back to the
-- reviewed default rather than to "no limit".

INSERT INTO platform_settings (key, value, description) VALUES (
  'refund.max_attempts',
  '3'::jsonb,
  'How many provider attempts one refund may ever make. Read as a CEILING: the '
  'loader clamps to 3, so configuration can lower it but never raise it. Only '
  'attempts that provably never reached the provider are retried at all.'
) ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value, description) VALUES (
  'refund.retry_backoff_seconds',
  '300'::jsonb,
  'Minimum wait between refund attempts. Read as a FLOOR: the loader clamps '
  'upward to at least 300 seconds, so configuration can slow retries down but '
  'never speed them up.'
) ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value, description) VALUES (
  'refund.stuck_in_flight_seconds',
  '900'::jsonb,
  'After this long, an in_flight refund is swept to in_doubt — not retried. '
  'Read as a FLOOR: configuration may wait longer before giving up on a '
  'response, never shorter.'
) ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value, description) VALUES (
  'refund.queue_batch_size',
  '20'::jsonb,
  'How many refunds one scheduler invocation may work through. Read as a '
  'CEILING.'
) ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE refunds IS
  'One refund per payment. Phase 3 executes refunds; it posts nothing to the '
  'ledger, because Phase 2 posts no capture to reverse.';
COMMENT ON TABLE refund_attempts IS
  'Append-only. Written before the provider call so a crash mid-flight leaves '
  'evidence rather than silence.';
COMMENT ON TABLE notification_outbox IS
  'Provider-neutral queue of things a person should be told. Nothing in Phase 3 '
  'delivers from it: no SMS provider has been chosen for Niger.';
