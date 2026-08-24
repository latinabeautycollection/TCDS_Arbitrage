\set ON_ERROR_STOP on
DO $$ BEGIN
 IF to_regclass('operations.domain10_certification_runs_10f') IS NULL THEN RAISE EXCEPTION '10F runs missing'; END IF;
 IF to_regclass('operations.domain10_certification_check_results_10f') IS NULL THEN RAISE EXCEPTION '10F check evidence missing'; END IF;
 IF to_regclass('operations.domain10_certification_attestations_10f') IS NULL THEN RAISE EXCEPTION '10F attestations missing'; END IF;
END $$;

DO $$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('operations.evaluate_domain10_certification_check_10f(uuid,text,integer)'::regprocedure)
        || coalesce(pg_get_functiondef(to_regprocedure('operations.evaluate_domain10_certification_check_10f_v1(uuid,text,integer)')),'') INTO def;
 IF position('resolve_authoritative_notification_policy' IN def)=0 THEN RAISE EXCEPTION '10F lacks 10B replay verification'; END IF;
 IF position('apply_telnyx' IN regexp_replace(def, 'apply_telnyx_delivery_event_10c\([a-z, ]*\)', '', 'g'))>0 THEN RAISE EXCEPTION '10F must not execute Telnyx behavior'; END IF;
END $$;

DO $$
DECLARE v_public integer;
BEGIN
 SELECT count(*) INTO v_public
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='operations' AND p.proname='execute_domain10_certification_run_10f'
   AND EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
              WHERE x.grantee=0 AND x.privilege_type='EXECUTE');
 IF v_public>0 THEN RAISE EXCEPTION 'PUBLIC can execute 10F certification'; END IF;
 IF has_function_privilege('tcds_operations_certifier_10f','operations.record_provider_acceptance_10c(uuid,uuid,text,text,text,integer,jsonb)','EXECUTE') THEN RAISE EXCEPTION '10F certifier can execute 10C provider acceptance'; END IF;
END $$;
\echo 'PASS: Domain 10F PostgreSQL contract tests.'
