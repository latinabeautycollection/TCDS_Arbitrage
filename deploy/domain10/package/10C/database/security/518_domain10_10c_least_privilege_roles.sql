-- Run as database owner/security administrator after 516/517.

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_delivery_executor') THEN
    CREATE ROLE tcds_operations_delivery_executor NOLOGIN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_receipt_processor') THEN
    CREATE ROLE tcds_operations_receipt_processor NOLOGIN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_reconciler') THEN
    CREATE ROLE tcds_operations_reconciler NOLOGIN;
  END IF;
END $$;

REVOKE ALL ON SCHEMA operations FROM PUBLIC;
GRANT USAGE ON SCHEMA operations TO
  tcds_operations_delivery_executor,
  tcds_operations_receipt_processor,
  tcds_operations_reconciler;

GRANT SELECT ON
  operations.notification_deliveries,
  operations.notification_outbox,
  operations.notification_requests,
  operations.notification_recipients,
  operations.operational_events,
  operations.channel_controls,
  operations.channel_rate_limits,
  operations.sms_subscriptions
TO tcds_operations_delivery_executor;

GRANT EXECUTE ON FUNCTION operations.claim_notification_outbox(text,text,integer,integer)
TO tcds_operations_delivery_executor;
GRANT EXECUTE ON FUNCTION operations.acquire_channel_rate_permit_10c(text,integer)
TO tcds_operations_delivery_executor;
GRANT EXECUTE ON FUNCTION operations.release_delivery_claim_10c(uuid,text,integer,text)
TO tcds_operations_delivery_executor;
GRANT EXECUTE ON FUNCTION operations.begin_delivery_execution_10c(uuid,text)
TO tcds_operations_delivery_executor;
GRANT EXECUTE ON FUNCTION operations.fail_delivery_execution_10c(
  uuid,uuid,text,text,text,integer,text,boolean,boolean,timestamptz
) TO tcds_operations_delivery_executor;
GRANT EXECUTE ON FUNCTION operations.record_provider_acceptance_10c(
  uuid,uuid,text,text,text,integer,jsonb
) TO tcds_operations_delivery_executor;

-- No direct grant on reviewed 10A record_provider_acceptance. 10C executor
-- must use the worker/lease-validating wrapper.
REVOKE ALL ON FUNCTION operations.record_provider_acceptance(
  uuid,uuid,text,text,integer,jsonb
) FROM tcds_operations_delivery_executor;

GRANT SELECT ON
  operations.notification_deliveries,
  operations.delivery_attempts,
  operations.provider_receipts
TO tcds_operations_receipt_processor;

GRANT EXECUTE ON FUNCTION operations.apply_telnyx_delivery_event_10c(
  text,text,text,timestamptz,text,jsonb,jsonb,uuid
) TO tcds_operations_receipt_processor;

-- Receipt processor is intentionally NOT granted reviewed 10A
-- record_final_delivery. The SECURITY DEFINER normalized receipt function is
-- the only path from a verified Telnyx webhook into final-delivery truth.
REVOKE ALL ON FUNCTION operations.record_final_delivery(
  uuid,text,text,jsonb,text,uuid
) FROM PUBLIC;

GRANT SELECT ON
  operations.delivery_reconciliation_tasks_10c,
  operations.notification_deliveries,
  operations.delivery_attempts,
  operations.provider_receipts
TO tcds_operations_reconciler;

GRANT EXECUTE ON FUNCTION operations.claim_delivery_reconciliation_10c(text,integer,integer)
TO tcds_operations_reconciler;
GRANT EXECUTE ON FUNCTION operations.mark_delivery_reconciliation_manual_review_10c(uuid,text,jsonb)
TO tcds_operations_reconciler;
GRANT EXECUTE ON FUNCTION operations.resolve_delivery_reconciliation_10c(uuid,text,text,jsonb)
TO tcds_operations_reconciler;

REVOKE ALL ON FUNCTION operations.acquire_channel_rate_permit_10c(text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.release_delivery_claim_10c(uuid,text,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.begin_delivery_execution_10c(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.fail_delivery_execution_10c(
  uuid,uuid,text,text,text,integer,text,boolean,boolean,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.record_provider_acceptance_10c(
  uuid,uuid,text,text,text,integer,jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.apply_telnyx_delivery_event_10c(
  text,text,text,timestamptz,text,jsonb,jsonb,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.claim_delivery_reconciliation_10c(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.mark_delivery_reconciliation_manual_review_10c(uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.resolve_delivery_reconciliation_10c(uuid,text,text,jsonb) FROM PUBLIC;
