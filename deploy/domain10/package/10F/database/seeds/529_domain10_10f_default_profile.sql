BEGIN;

INSERT INTO operations.domain10_certification_profiles_10f(profile_key,description,enabled)
VALUES('DOMAIN10_ENTERPRISE_RELEASE','Full Domain 10 A-F enterprise release certification',true)
ON CONFLICT(profile_key) DO NOTHING;

WITH p AS(SELECT profile_id FROM operations.domain10_certification_profiles_10f WHERE profile_key='DOMAIN10_ENTERPRISE_RELEASE')
INSERT INTO operations.domain10_certification_profile_versions_10f(profile_id,version,lifecycle_state,settlement_grace_seconds)
SELECT profile_id,1,'DRAFT',300 FROM p
ON CONFLICT(profile_id,version) DO NOTHING;

WITH p AS(SELECT profile_id FROM operations.domain10_certification_profiles_10f WHERE profile_key='DOMAIN10_ENTERPRISE_RELEASE')
INSERT INTO operations.domain10_certification_profile_checks_10f(profile_id,profile_version,check_key,required,minimum_sample_size,ordinal)
SELECT p.profile_id,1,v.check_key,true,v.min_sample,v.ordinal FROM p CROSS JOIN (VALUES
 ('STRUCTURAL_10A_CORE',0,1),('STRUCTURAL_10B_CORE',0,2),('STRUCTURAL_10C_CORE',0,3),
 ('STRUCTURAL_10D_CORE',0,4),('STRUCTURAL_10E_CORE',0,5),('AUDIT_HASH_CHAIN',1,6),
 ('DECISION_POLICY_REPLAY',1,7),('DELIVERY_PLAN_INTEGRITY',1,8),('GRAPH_ACCEPTANCE_SEMANTICS',1,9),
 ('UNKNOWN_OUTCOME_RECONCILIATION',0,10),('TELNYX_FINAL_EVIDENCE',1,11),
 ('INCIDENT_REQUIRED_LINKAGE',1,12),('ACK_DEADLINE_INTEGRITY',1,13),
 ('ESCALATION_SETTLEMENT_INTEGRITY',1,14),('ASSURANCE_RESULT_INTEGRITY',1,15),
 ('ASSURANCE_EPISODE_INTEGRITY',0,16),('ASSURANCE_EVENT_LINKAGE',1,17),('PUBLIC_EXECUTE_LOCKDOWN',0,18)
) v(check_key,min_sample,ordinal)
ON CONFLICT DO NOTHING;

WITH p AS(SELECT profile_id FROM operations.domain10_certification_profiles_10f WHERE profile_key='DOMAIN10_ENTERPRISE_RELEASE')
INSERT INTO operations.domain10_certification_profile_attestations_10f(profile_id,profile_version,attestation_type,required,ordinal)
SELECT p.profile_id,1,v.attestation_type,true,v.ordinal FROM p CROSS JOIN (VALUES
 ('POSTGRES_MIGRATION_SUITE_PASS',1),('PRODUCTION_ROOT_NPM_CI_PASS',2),('PRODUCTION_ROOT_BUILD_PASS',3),
 ('PRODUCTION_ROOT_JEST_PASS',4),('OUTBOX_SKIP_LOCKED_CONCURRENCY_PASS',5),
 ('GRAPH_LIVE_DELIVERY_DRILL_PASS',6),('TELNYX_LIVE_DELIVERY_DRILL_PASS',7),
 ('SMS_STOP_BEFORE_SEND_DRILL_PASS',8),('INCIDENT_ACK_ESCALATION_DRILL_PASS',9),
 ('ASSURANCE_BREACH_RECOVERY_DRILL_PASS',10),('REPOSITORY_COLLISION_PREFLIGHT_PASS',11)
) v(attestation_type,ordinal)
ON CONFLICT DO NOTHING;

DO $$ DECLARE pid uuid;st text;
BEGIN
 SELECT profile_id INTO pid FROM operations.domain10_certification_profiles_10f WHERE profile_key='DOMAIN10_ENTERPRISE_RELEASE';
 SELECT lifecycle_state INTO st FROM operations.domain10_certification_profile_versions_10f WHERE profile_id=pid AND version=1;
 IF st='DRAFT' THEN PERFORM operations.freeze_domain10_certification_profile_10f(pid,1,'DOMAIN10_10F_MIGRATION'); END IF;
END $$;

COMMIT;


DO $$
DECLARE pid uuid;v_checks integer;v_atts integer;v_state text;
BEGIN
 SELECT profile_id INTO pid FROM operations.domain10_certification_profiles_10f
 WHERE profile_key='DOMAIN10_ENTERPRISE_RELEASE';
 SELECT count(*) INTO v_checks FROM operations.domain10_certification_profile_checks_10f
 WHERE profile_id=pid AND profile_version=1;
 SELECT count(*) INTO v_atts FROM operations.domain10_certification_profile_attestations_10f
 WHERE profile_id=pid AND profile_version=1;
 SELECT lifecycle_state INTO v_state FROM operations.domain10_certification_profile_versions_10f
 WHERE profile_id=pid AND version=1;
 IF v_checks<>18 OR v_atts<>11 OR v_state<>'FROZEN' THEN
   RAISE EXCEPTION '10F default certification profile verification failed';
 END IF;
END $$;
