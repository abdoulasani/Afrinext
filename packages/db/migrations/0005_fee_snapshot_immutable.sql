-- Frozen fee schedules are evidence, and evidence that can be edited is not
-- evidence. A seller asking "why did I receive this amount?" must get an answer
-- that nobody could have rewritten after the fact.
--
-- Commission rules stay mutable — the rate genuinely changes over time. What is
-- frozen is the resolved outcome for a particular sale.

CREATE TRIGGER fee_schedules_append_only
  BEFORE UPDATE OR DELETE ON fee_schedules
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER fee_lines_append_only
  BEFORE UPDATE OR DELETE ON fee_lines
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

REVOKE UPDATE, DELETE ON fee_schedules FROM afrinext_app;
REVOKE UPDATE, DELETE ON fee_lines     FROM afrinext_app;

-- A schedule's lines must re-sum to its gross. The residual rule guarantees this
-- arithmetically; this asserts it at the database level so a future code path
-- cannot quietly write a split that does not add up.
CREATE OR REPLACE FUNCTION assert_fee_schedule_balances() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  schedule_gross bigint;
  line_total     bigint;
BEGIN
  SELECT gross_minor INTO schedule_gross FROM fee_schedules WHERE id = NEW.schedule_id;
  SELECT coalesce(sum(amount_minor), 0) INTO line_total FROM fee_lines WHERE schedule_id = NEW.schedule_id;

  IF line_total <> schedule_gross THEN
    RAISE EXCEPTION
      'Fee schedule % lines total % but gross is %', NEW.schedule_id, line_total, schedule_gross
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER fee_lines_must_total_gross
  AFTER INSERT ON fee_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_fee_schedule_balances();
