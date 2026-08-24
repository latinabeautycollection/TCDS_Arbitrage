-- ============================================================================
-- TCDS DOMAIN 10 / SLICE 10C — HARDENING PASS
-- Applies after 516.
-- ============================================================================

BEGIN;

-- 1. Reconciliation evidence is controlled and may not be deleted.
CREATE OR REPLACE FUNCTION operations.guard_delivery_reconciliation_10c()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'delivery_reconciliation_tasks_10c cannot be deleted';
  END IF;

  IF OLD.state IN('RESOLVED','CANCELLED') THEN
    RAISE EXCEPTION 'resolved/cancelled reconciliation tasks are immutable';
  END IF;

  IF NEW.delivery_id<>OLD.delivery_id OR NEW.provider<>OLD.provider OR
     NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'reconciliation task identity is immutable';
  END IF;

  IF NEW.state<>OLD.state THEN
    IF NOT (
      (OLD.state='PENDING' AND NEW.state='CLAIMED') OR
      (OLD.state='CLAIMED' AND NEW.state IN('PENDING','MANUAL_REVIEW_REQUIRED','RESOLVED','CANCELLED')) OR
      (OLD.state='MANUAL_REVIEW_REQUIRED' AND NEW.state IN('RESOLVED','CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'Invalid reconciliation transition: % -> %',OLD.state,NEW.state;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_delivery_reconciliation_10c_guard
ON operations.delivery_reconciliation_tasks_10c;

CREATE TRIGGER trg_delivery_reconciliation_10c_guard
BEFORE UPDATE OR DELETE ON operations.delivery_reconciliation_tasks_10c
FOR EACH ROW EXECUTE FUNCTION operations.guard_delivery_reconciliation_10c();

-- 2. Prevent accidental Graph delivery promotion from provider receipts.
--    10A already restricts record_final_delivery evidence source; this adds an
--    explicit 10C assertion helper used by certification and reconciliation.
CREATE OR REPLACE FUNCTION operations.assert_graph_not_delivery_confirmed_by_202_10c(
  p_delivery_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT NOT EXISTS(
    SELECT 1
    FROM operations.notification_deliveries d
    JOIN operations.provider_receipts r ON r.delivery_id=d.delivery_id
    WHERE d.delivery_id=p_delivery_id
      AND d.provider='MICROSOFT_GRAPH'
      AND d.delivered_at IS NOT NULL
      AND r.receipt_type='PROVIDER_ACCEPTED'
      AND r.evidence_source IS NULL
  )
$$;

-- 3. No delivery retry may exceed the frozen 10A attempt ceiling.
CREATE OR REPLACE FUNCTION operations.guard_delivery_attempt_ceiling_10c()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_max integer;
BEGIN
  SELECT max_attempts INTO v_max
  FROM operations.notification_deliveries
  WHERE delivery_id=NEW.delivery_id;

  IF NEW.attempt_number>v_max THEN
    RAISE EXCEPTION 'delivery attempt exceeds frozen max_attempts';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_delivery_attempt_ceiling_10c
ON operations.delivery_attempts;

CREATE TRIGGER trg_delivery_attempt_ceiling_10c
BEFORE INSERT ON operations.delivery_attempts
FOR EACH ROW EXECUTE FUNCTION operations.guard_delivery_attempt_ceiling_10c();

-- 4. Ensure Telnyx receipt provider-event IDs are never blank.
ALTER TABLE operations.provider_receipts
  DROP CONSTRAINT IF EXISTS chk_10c_provider_event_nonblank;

ALTER TABLE operations.provider_receipts
  ADD CONSTRAINT chk_10c_provider_event_nonblank
  CHECK(provider_event_id IS NULL OR btrim(provider_event_id)<>'');

-- 5. Reconciliation is automatically created for pre-existing UNKNOWN rows.
INSERT INTO operations.delivery_reconciliation_tasks_10c(delivery_id,provider,reason)
SELECT delivery_id,provider,'UNKNOWN_PROVIDER_OUTCOME'
FROM operations.notification_deliveries
WHERE state='UNKNOWN_PROVIDER_OUTCOME'
ON CONFLICT(delivery_id) DO NOTHING;

COMMIT;
