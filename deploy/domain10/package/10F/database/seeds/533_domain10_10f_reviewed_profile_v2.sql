-- ============================================================================
-- TCDS DOMAIN 10F — REVIEWED ENTERPRISE RELEASE PROFILE V2
-- ============================================================================

BEGIN;

DO $$
DECLARE pid uuid; st text;
BEGIN
  SELECT profile_id INTO pid
  FROM operations.domain10_certification_profiles_10f
  WHERE profile_key='DOMAIN10_ENTERPRISE_RELEASE';

  IF pid IS NULL THEN
    RAISE EXCEPTION '10F default certification profile missing';
  END IF;

  SELECT lifecycle_state INTO st
  FROM operations.domain10_certification_profile_versions_10f
  WHERE profile_id=pid AND version=1;

  IF st='FROZEN' THEN
    UPDATE operations.domain10_certification_profile_versions_10f
    SET lifecycle_state='RETIRED'
    WHERE profile_id=pid AND version=1;
  END IF;

  INSERT INTO operations.domain10_certification_profile_versions_10f(
    profile_id,version,lifecycle_state,settlement_grace_seconds
  )
  VALUES(pid,2,'DRAFT',300)
  ON CONFLICT(profile_id,version) DO NOTHING;
END $$;

WITH p AS(
  SELECT profile_id
  FROM operations.domain10_certification_profiles_10f
  WHERE profile_key='DOMAIN10_ENTERPRISE_RELEASE'
)
INSERT INTO operations.domain10_certification_profile_checks_10f(
  profile_id,profile_version,check_key,required,minimum_sample_size,ordinal
)
SELECT p.profile_id,2,v.check_key,true,v.min_sample,v.ordinal
FROM p CROSS JOIN (VALUES
 ('STRUCTURAL_10A_CORE',0,1),
 ('STRUCTURAL_10B_CORE',0,2),
 ('STRUCTURAL_10C_CORE',0,3),
 ('STRUCTURAL_10D_CORE',0,4),
 ('STRUCTURAL_10E_CORE',0,5),
 ('AUDIT_HASH_CHAIN',1,6),
 ('DECISION_POLICY_REPLAY',1,7),
 ('DELIVERY_PLAN_INTEGRITY',1,8),
 ('GRAPH_ACCEPTANCE_SEMANTICS',1,9),
 ('GRAPH_FINAL_DELIVERY_EVIDENCE',0,10),
 ('UNKNOWN_OUTCOME_RECONCILIATION',0,11),
 ('TELNYX_FINAL_EVIDENCE',1,12),
 ('TELNYX_TERMINAL_FAILURE_EVIDENCE',0,13),
 ('SMS_SEND_CONSENT_INTEGRITY',1,14),
 ('INCIDENT_REQUIRED_LINKAGE',1,15),
 ('ACK_DEADLINE_INTEGRITY',1,16),
 ('ESCALATION_SETTLEMENT_INTEGRITY',1,17),
 ('ASSURANCE_RESULT_INTEGRITY',1,18),
 ('ASSURANCE_EPISODE_INTEGRITY',0,19),
 ('ASSURANCE_EVENT_LINKAGE',1,20),
 ('PUBLIC_EXECUTE_LOCKDOWN',0,21)
) v(check_key,min_sample,ordinal)
ON CONFLICT DO NOTHING;

WITH p AS(
  SELECT profile_id
  FROM operations.domain10_certification_profiles_10f
  WHERE profile_key='DOMAIN10_ENTERPRISE_RELEASE'
)
INSERT INTO operations.domain10_certification_profile_attestations_10f(
  profile_id,profile_version,attestation_type,required,
  independent_attestor_required,ordinal
)
SELECT p.profile_id,2,v.attestation_type,true,v.independent,v.ordinal
FROM p CROSS JOIN (VALUES
 ('POSTGRES_MIGRATION_SUITE_PASS',false,1),
 ('PRODUCTION_ROOT_NPM_CI_PASS',false,2),
 ('PRODUCTION_ROOT_BUILD_PASS',false,3),
 ('PRODUCTION_ROOT_JEST_PASS',false,4),
 ('OUTBOX_SKIP_LOCKED_CONCURRENCY_PASS',true,5),
 ('GRAPH_LIVE_DELIVERY_DRILL_PASS',true,6),
 ('TELNYX_LIVE_DELIVERY_DRILL_PASS',true,7),
 ('SMS_STOP_BEFORE_SEND_DRILL_PASS',true,8),
 ('INCIDENT_ACK_ESCALATION_DRILL_PASS',true,9),
 ('ASSURANCE_BREACH_RECOVERY_DRILL_PASS',true,10),
 ('REPOSITORY_COLLISION_PREFLIGHT_PASS',false,11),
 ('GRAPH_EXCHANGE_RBAC_SCOPE_PASS',true,12),
 ('GRAPH_UNSCOPED_ENTRA_MAILSEND_REMOVED_PASS',true,13),
 ('GRAPH_CERTIFICATE_AUTH_EXPIRY_PASS',true,14),
 ('EXCHANGE_FINAL_DELIVERY_RECONCILIATION_PASS',true,15),
 ('TELNYX_WEBHOOK_SIGNATURE_VERIFICATION_PASS',true,16),
 ('TELNYX_DUPLICATE_OUT_OF_ORDER_WEBHOOK_PASS',true,17),
 ('SMS_START_STOP_HELP_COMPLIANCE_PASS',true,18),
 ('TELNYX_10DLC_CAMPAIGN_ACTIVE_PASS',true,19)
) v(attestation_type,independent,ordinal)
ON CONFLICT DO NOTHING;

DO $$
DECLARE pid uuid; st text;
BEGIN
  SELECT profile_id INTO pid
  FROM operations.domain10_certification_profiles_10f
  WHERE profile_key='DOMAIN10_ENTERPRISE_RELEASE';

  SELECT lifecycle_state INTO st
  FROM operations.domain10_certification_profile_versions_10f
  WHERE profile_id=pid AND version=2;

  IF st='DRAFT' THEN
    PERFORM operations.freeze_domain10_certification_profile_10f(
      pid,2,'DOMAIN10_10F_REVIEWED_PROFILE_V2'
    );
  END IF;
END $$;

DO $$
DECLARE
  pid uuid;
  v_checks integer;
  v_atts integer;
  v_state text;
  v1_state text;
BEGIN
  SELECT profile_id INTO pid
  FROM operations.domain10_certification_profiles_10f
  WHERE profile_key='DOMAIN10_ENTERPRISE_RELEASE';

  SELECT count(*) INTO v_checks
  FROM operations.domain10_certification_profile_checks_10f
  WHERE profile_id=pid AND profile_version=2;

  SELECT count(*) INTO v_atts
  FROM operations.domain10_certification_profile_attestations_10f
  WHERE profile_id=pid AND profile_version=2;

  SELECT lifecycle_state INTO v_state
  FROM operations.domain10_certification_profile_versions_10f
  WHERE profile_id=pid AND version=2;

  SELECT lifecycle_state INTO v1_state
  FROM operations.domain10_certification_profile_versions_10f
  WHERE profile_id=pid AND version=1;

  IF v_checks<>21 OR v_atts<>19 OR v_state<>'FROZEN' OR v1_state<>'RETIRED' THEN
    RAISE EXCEPTION '10F reviewed certification profile v2 verification failed';
  END IF;
END $$;

COMMIT;
