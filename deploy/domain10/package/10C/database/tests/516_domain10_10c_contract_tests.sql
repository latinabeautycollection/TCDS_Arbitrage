\set ON_ERROR_STOP on

-- Disposable certification database only. Requires reviewed 10A + reviewed 10B + 516/517.

-- 1. New 10C table/function surface.
DO $$
BEGIN
  IF to_regclass('operations.delivery_reconciliation_tasks_10c') IS NULL THEN
    RAISE EXCEPTION '10C reconciliation table missing';
  END IF;
  IF to_regprocedure('operations.begin_delivery_execution_10c(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '10C begin execution function missing';
  END IF;
  IF to_regprocedure('operations.apply_telnyx_delivery_event_10c(text,text,text,timestamptz,text,jsonb,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION '10C Telnyx receipt function missing';
  END IF;
END $$;

-- 2. Verify delivery claim still comes from reviewed 10A and includes SKIP LOCKED.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('operations.claim_notification_outbox(text,text,integer,integer)'::regprocedure)
  INTO def;
  IF position('SKIP LOCKED' IN upper(def))=0 THEN
    RAISE EXCEPTION '10A claim_notification_outbox lost SKIP LOCKED';
  END IF;
END $$;

-- 3. Graph 202 acceptance semantic remains enforced by 10A.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('operations.record_provider_acceptance(uuid,uuid,text,text,integer,jsonb)'::regprocedure)
  INTO def;
  IF position('MICROSOFT_GRAPH' IN upper(def))=0 OR position('202' IN def)=0 THEN
    RAISE EXCEPTION 'Graph HTTP 202 contract is missing';
  END IF;
END $$;

-- 4. SMS send-time consent gate remains installed.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('operations.begin_delivery_execution_10c(uuid,text)'::regprocedure)
  INTO def;
  IF position('sms_delivery_currently_eligible' IN def)=0 THEN
    RAISE EXCEPTION '10C SMS send-time consent gate missing';
  END IF;
END $$;

-- 5. Unknown provider outcomes are not retry paths.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(
    'operations.fail_delivery_execution_10c(uuid,uuid,text,text,text,integer,text,boolean,boolean,timestamptz)'::regprocedure
  ) INTO def;
  IF position('UNKNOWN_PROVIDER_OUTCOME' IN def)=0
     OR position('delivery_reconciliation_tasks_10c' IN def)=0 THEN
    RAISE EXCEPTION 'Ambiguous delivery quarantine missing';
  END IF;
END $$;

-- 6. Telnyx finalization is evidence-driven and provider-event deduplicated.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(
    'operations.apply_telnyx_delivery_event_10c(text,text,text,timestamptz,text,jsonb,jsonb,uuid)'::regprocedure
  ) INTO def;
  IF position('message.finalized' IN def)=0
     OR position('record_final_delivery' IN def)=0
     OR position('DUPLICATE' IN def)=0
     OR position('IGNORED_STALE' IN def)=0 THEN
    RAISE EXCEPTION 'Telnyx final delivery evidence controls incomplete';
  END IF;
END $$;

-- 7. Reconciliation worker never owns send/replay DB permission.
DO $$
BEGIN
  IF has_function_privilege(
       'tcds_operations_reconciler',
       'operations.begin_delivery_execution_10c(uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Reconciler must not execute provider delivery';
  END IF;
END $$;

\echo 'PASS: Domain 10C PostgreSQL contract tests.'


-- 8. Reconciliation manual-review state must be resolvable later.
DO $$
BEGIN
  IF to_regprocedure('operations.mark_delivery_reconciliation_manual_review_10c(uuid,text,jsonb)') IS NULL
     OR to_regprocedure('operations.resolve_delivery_reconciliation_10c(uuid,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Resolvable reconciliation state machine missing';
  END IF;
END $$;

-- 9. Executor must use 10C acceptance wrapper; receipt processor must not
--    have direct record_final_delivery authority.
DO $$
BEGIN
  IF NOT has_function_privilege(
    'tcds_operations_delivery_executor',
    'operations.record_provider_acceptance_10c(uuid,uuid,text,text,text,integer,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Delivery executor lacks 10C acceptance wrapper';
  END IF;

  IF has_function_privilege(
    'tcds_operations_receipt_processor',
    'operations.record_final_delivery(uuid,text,text,jsonb,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Receipt processor has unsafe direct final-delivery authority';
  END IF;
END $$;
