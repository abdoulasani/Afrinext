-- Ledger invariants that the ORM cannot express.
--
-- Three guarantees are established here, in the database rather than in
-- application code, because application code can be bypassed and money cannot
-- be un-lost:
--   1. every transaction balances, per currency;
--   2. an entry's currency matches the account it posts to;
--   3. ledger entries and transactions are append-only.

--------------------------------------------------------------------------------
-- 1. Every transaction balances.
--------------------------------------------------------------------------------
-- Deferred to COMMIT so all of a transaction's entries can be inserted before
-- the invariant is evaluated. An unbalanced transaction fails the COMMIT.
CREATE OR REPLACE FUNCTION assert_transaction_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  offending record;
BEGIN
  SELECT e.currency, sum(e.direction::bigint * e.amount_minor) AS net
    INTO offending
    FROM ledger_entries e
   WHERE e.transaction_id = NEW.transaction_id
   GROUP BY e.currency
  HAVING sum(e.direction::bigint * e.amount_minor) <> 0
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Ledger transaction % does not balance in %: net % minor units',
      NEW.transaction_id, offending.currency, offending.net
      USING ERRCODE = 'check_violation';
  END IF;

  -- A transaction with a single entry can never be meaningful double entry.
  IF (SELECT count(*) FROM ledger_entries WHERE transaction_id = NEW.transaction_id) < 2 THEN
    RAISE EXCEPTION
      'Ledger transaction % has fewer than two entries', NEW.transaction_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_must_balance
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_transaction_balanced();

--------------------------------------------------------------------------------
-- 2. An entry's currency matches its account's currency.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_entry_currency_matches_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account_currency char(3);
BEGIN
  SELECT currency INTO account_currency FROM ledger_accounts WHERE id = NEW.account_id;
  IF account_currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION
      'Entry currency % does not match account % currency %',
      NEW.currency, NEW.account_id, account_currency
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entries_currency_matches_account
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION assert_entry_currency_matches_account();

--------------------------------------------------------------------------------
-- 3. Append-only.
--------------------------------------------------------------------------------
-- A trigger rather than only a REVOKE, because a superuser ignores REVOKE and
-- development connections are often superuser. Correcting a mistake means
-- posting a compensating transaction, never editing history.
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% on % is not permitted: this table is append-only. Post a compensating entry instead.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER ledger_transactions_append_only
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER consent_records_append_only
  BEFORE UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

--------------------------------------------------------------------------------
-- 4. Least-privilege application role.
--------------------------------------------------------------------------------
-- Production connects as afrinext_app, never as a superuser. The REVOKEs are
-- defence in depth behind the triggers above.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afrinext_app') THEN
    CREATE ROLE afrinext_app NOLOGIN;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO afrinext_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO afrinext_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO afrinext_app;

REVOKE UPDATE, DELETE ON ledger_entries      FROM afrinext_app;
REVOKE UPDATE, DELETE ON ledger_transactions FROM afrinext_app;
REVOKE UPDATE, DELETE ON consent_records     FROM afrinext_app;
REVOKE UPDATE, DELETE ON audit_logs          FROM afrinext_app;

--------------------------------------------------------------------------------
-- 5. Reconciliation helper: the authoritative balance, computed from entries.
--------------------------------------------------------------------------------
-- account_balances is a cache. This view is the truth it is checked against.
CREATE OR REPLACE VIEW ledger_account_balances_derived AS
  SELECT a.id AS account_id,
         a.kind,
         a.owner_type,
         a.owner_id,
         a.currency,
         coalesce(sum(e.direction::bigint * e.amount_minor), 0)::bigint AS balance_minor,
         count(e.id)::bigint AS entry_count
    FROM ledger_accounts a
    LEFT JOIN ledger_entries e ON e.account_id = a.id
   GROUP BY a.id, a.kind, a.owner_type, a.owner_id, a.currency;
