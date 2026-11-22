-- 644_rollback (ours). FULL rollback of the Recovery V1.9.2 install: our 644 + vendor 641, 640, 637, 635, 634 + 644_pre.
-- Returns the catalog to what 644_pre recorded: exact 621 guard, function-owner privileges, no v18/v19/v191 objects.
-- Works whether or not 644 ran (vendor roles are removed if still present). Refuses while recovery work is in flight.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s';
DO $pre$ BEGIN
 IF to_regclass('warehouse_identity.recovery_v192_ledger') IS NULL THEN RAISE EXCEPTION 'R644RB_LEDGER_MISSING (nothing to roll back, or installed without 644_pre)'; END IF;
 IF to_regclass('warehouse_identity.recovery_secret_outbox_v18') IS NOT NULL
  AND EXISTS (SELECT 1 FROM warehouse_identity.recovery_secret_outbox_v18 WHERE status IN ('PENDING','SENDING'))
 THEN RAISE EXCEPTION 'R644RB_DELIVERIES_IN_FLIGHT'; END IF;
 IF to_regclass('warehouse_identity.recovery_claim_bindings_v191') IS NOT NULL
  AND EXISTS (SELECT 1 FROM warehouse_identity.recovery_claim_bindings_v191 WHERE expires_at > clock_timestamp())
 THEN RAISE EXCEPTION 'R644RB_ACTIVE_BROWSER_CLAIMS'; END IF;
END $pre$;

-- our functions
DO $f$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'warehouse_identity'::regnamespace AND p.proname LIKE 'recovery\_%\_v192' LOOP
  EXECUTE format('DROP FUNCTION %s', f);
 END LOOP;
END $f$;
-- vendor 640/641/637/634 objects (their policies and grants go with the tables)
DROP TABLE IF EXISTS warehouse_identity.recovery_claim_bindings_v191;
DROP TABLE IF EXISTS warehouse_identity.recovery_issuance_jobs_v19;
DROP TABLE IF EXISTS warehouse_identity.recovery_invitation_refs_v18;
DROP TABLE IF EXISTS warehouse_identity.recovery_secret_outbox_v18;
DROP TABLE IF EXISTS warehouse_identity.recovery_action_challenges_v18;
-- vendor 635: restore the exact 621 guard, drop its proof gate and policy
DO $g$ DECLARE d text; BEGIN
 SELECT value INTO d FROM warehouse_identity.recovery_v192_ledger WHERE item = 'guard_def';
 EXECUTE d;
END $g$;
DROP FUNCTION IF EXISTS warehouse_identity.recovery_proof_eligible_v18(uuid,uuid);
DROP POLICY IF EXISTS r635_fn_owner_challenges ON warehouse_identity.recovery_contact_challenges_v1;
-- function-owner privileges back to the recorded state (covers 635's challenge SELECT and our 644 grants)
DO $p$ DECLARE l record; pr text; BEGIN
 FOR l IN SELECT substr(item, 6) AS t, value FROM warehouse_identity.recovery_v192_ledger WHERE item LIKE 'priv:%' LOOP
  FOR pr IN SELECT DISTINCT x.privilege_type FROM pg_class c, aclexplode(c.relacl) x
    WHERE c.oid = ('warehouse_identity.'||l.t)::regclass AND x.grantee = 'tcds_identity_function_owner'::regrole LOOP
   IF NOT (pr = ANY(string_to_array(l.value, ','))) THEN
    EXECUTE format('REVOKE %s ON warehouse_identity.%I FROM tcds_identity_function_owner', pr, l.t);
   END IF;
  END LOOP;
 END LOOP;
 FOR l IN SELECT substr(item, 6) AS f, value FROM warehouse_identity.recovery_v192_ledger WHERE item LIKE 'exec:%' LOOP
  IF l.value = 'false' AND EXISTS (SELECT 1 FROM pg_proc pr2, aclexplode(pr2.proacl) x WHERE pr2.oid = l.f::regprocedure
    AND x.grantee = 'tcds_identity_function_owner'::regrole AND x.privilege_type = 'EXECUTE') THEN
   EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM tcds_identity_function_owner', l.f);
  END IF;
 END LOOP;
END $p$;
-- vendor roles, if 644 never removed them
DO $r$ DECLARE r text; pol record; BEGIN
 FOREACH r IN ARRAY ARRAY['tcds_recovery_verifier_v18','tcds_recovery_otp_v18','tcds_recovery_delivery_v18'] LOOP
  IF to_regrole(r) IS NOT NULL THEN
   FOR pol IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE r::name = ANY(roles) LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
   END LOOP;
   EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA warehouse_identity FROM %I', r);
   EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA warehouse_identity FROM %I', r);
   EXECUTE format('REVOKE ALL ON SCHEMA warehouse_identity FROM %I', r);
   EXECUTE format('DROP ROLE %I', r);
  END IF;
 END LOOP;
END $r$;
DO $v$ BEGIN
 IF md5(pg_get_functiondef('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'::regprocedure))
    <> (SELECT value FROM warehouse_identity.recovery_v192_ledger WHERE item = 'guard_md5')
 THEN RAISE EXCEPTION 'R644RB_GUARD_NOT_RESTORED'; END IF;
END $v$;
DROP TABLE warehouse_identity.recovery_v192_ledger;
COMMIT;
