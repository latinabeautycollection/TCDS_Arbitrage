\set ON_ERROR_STOP on

DO $$
DECLARE fn regprocedure; def text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'operations.claim_incident_activation_10d(text,integer,integer)'::regprocedure,
    'operations.activate_incident_from_notification_10d(uuid,text)'::regprocedure,
    'operations.claim_ack_deadlines_10d(text,integer,integer)'::regprocedure,
    'operations.claim_due_incident_escalations_10d(text,integer,integer)'::regprocedure,
    'operations.prepare_escalation_emission_10d(uuid,text)'::regprocedure,
    'operations.claim_escalation_settlements_10d(text,integer,integer)'::regprocedure
  ]
  LOOP
    SELECT pg_get_functiondef(fn) INTO def;
    IF position('SECURITY DEFINER' IN upper(def))=0 THEN
      RAISE EXCEPTION '% is not SECURITY DEFINER',fn;
    END IF;
    IF position('search_path' IN lower(def))=0 THEN
      RAISE EXCEPTION '% has no fixed search_path',fn;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF has_function_privilege(
    'public',
    'operations.claim_due_incident_escalations_10d(text,integer,integer)',
    'EXECUTE'
  ) THEN RAISE EXCEPTION 'PUBLIC can claim incident escalations'; END IF;

  IF has_function_privilege(
    'public',
    'operations.prepare_escalation_emission_10d(uuid,text)',
    'EXECUTE'
  ) THEN RAISE EXCEPTION 'PUBLIC can prepare escalation emissions'; END IF;
END $$;

DO $$
BEGIN
  IF to_regprocedure(
    'operations.validate_incident_escalation_binding_for_event_10d(uuid,text,text,timestamptz)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Authoritative escalation binding validator missing';
  END IF;
END $$;

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(
    'operations.prepare_escalation_emission_10d(uuid,text)'::regprocedure
  ) INTO def;
  IF position('max_emission_attempts' IN def)=0
     OR position('emission_attempt_count' IN def)=0 THEN
    RAISE EXCEPTION 'Escalation event emission attempts are not bounded';
  END IF;
END $$;

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(
    'operations.incident_actor_authorized_10d(uuid,uuid,boolean)'::regprocedure
  ) INTO def;
  IF position('IF p_require_owner THEN' IN def)=0 THEN
    RAISE EXCEPTION 'Owner-required authorization branch missing';
  END IF;
END $$;

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(
    'operations.apply_incident_command_10d(text,text,text,uuid,text,timestamptz,uuid,text)'::regprocedure
  ) INTO def;
  IF position('idempotency collision' IN lower(def))=0 THEN
    RAISE EXCEPTION 'Incident command collision protection missing';
  END IF;
END $$;

\echo 'PASS: Domain 10D reviewed hardening certification.'
