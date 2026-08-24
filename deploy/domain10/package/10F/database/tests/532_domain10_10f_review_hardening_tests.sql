\set ON_ERROR_STOP on

-- Reviewed profile v2 exists and v1 is retired.
DO $$
DECLARE pid uuid;v1 text;v2 text;c integer;a integer;
BEGIN
  SELECT profile_id INTO pid
  FROM operations.domain10_certification_profiles_10f
  WHERE profile_key='DOMAIN10_ENTERPRISE_RELEASE';

  SELECT lifecycle_state INTO v1
  FROM operations.domain10_certification_profile_versions_10f
  WHERE profile_id=pid AND version=1;

  SELECT lifecycle_state INTO v2
  FROM operations.domain10_certification_profile_versions_10f
  WHERE profile_id=pid AND version=2;

  SELECT count(*) INTO c
  FROM operations.domain10_certification_profile_checks_10f
  WHERE profile_id=pid AND profile_version=2;

  SELECT count(*) INTO a
  FROM operations.domain10_certification_profile_attestations_10f
  WHERE profile_id=pid AND profile_version=2;

  IF v1<>'RETIRED' OR v2<>'FROZEN' OR c<>21 OR a<>19 THEN
    RAISE EXCEPTION '10F reviewed profile v2 is not authoritative';
  END IF;
END $$;

-- Audit check must recompute record hashes.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(
    'operations.evaluate_domain10_certification_check_10f(uuid,text,integer)'::regprocedure
  ) INTO def;

  IF position('recomputed_hash' IN def)=0 THEN
    RAISE EXCEPTION '10F audit certification does not recompute record hashes';
  END IF;

  IF position('GRAPH_FINAL_DELIVERY_EVIDENCE' IN def)=0 THEN
    RAISE EXCEPTION '10F lacks Exchange final-delivery evidence certification';
  END IF;

  IF position('SMS_SEND_CONSENT_INTEGRITY' IN def)=0 THEN
    RAISE EXCEPTION '10F lacks SMS consent-at-send certification';
  END IF;
END $$;

-- Fingerprint includes constraints, triggers, indexes and SHA-256 function defs.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(
    'operations.compute_domain10_schema_fingerprint_10f()'::regprocedure
  ) INTO def;

  IF position('pg_get_constraintdef' IN def)=0
     OR position('pg_get_triggerdef' IN def)=0
     OR position('pg_get_indexdef' IN def)=0
     OR position('sha256' IN def)=0 THEN
    RAISE EXCEPTION '10F schema fingerprint is incomplete';
  END IF;
END $$;

-- Certification roles cannot execute provider/incident/SLO authority.
DO $$
BEGIN
  IF has_function_privilege(
    'tcds_operations_certifier_10f',
    'operations.record_provider_acceptance_10c(uuid,uuid,text,text,text,integer,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION '10F certifier has 10C provider authority';
  END IF;

  IF has_function_privilege(
    'tcds_operations_certification_attestor_10f',
    'operations.apply_incident_command_10d(text,text,text,uuid,text,timestamptz,uuid,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION '10F attestor has 10D incident authority';
  END IF;
END $$;

\echo 'PASS: Domain 10F reviewed enterprise hardening tests.'
