-- READ-ONLY RLS/access safety gate. Run on the exact STAGING database as a DBA.
-- Does not execute SET ROLE and does not make grants or migrations.
-- A passing catalog check does NOT replace actual SET ROLE functional tests.
DO $gate$
DECLARE req record; pol_count integer;
BEGIN
 IF to_regclass('warehouse_identity.recovery_claim_bindings_v191') IS NULL
 OR to_regclass('warehouse_identity.recovery_proofs_v1') IS NULL
 OR to_regclass('warehouse_identity.recovery_issuance_jobs_v19') IS NULL
 OR to_regprocedure('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)') IS NULL
 THEN RAISE EXCEPTION 'RLS_GATE_DEPENDENCIES_MISSING'; END IF;
 FOR req IN SELECT * FROM (VALUES
  ('auth_sessions','tcds_recovery_verifier_v18'),
  ('employees','tcds_recovery_verifier_v18'),
  ('password_reset_requests','tcds_recovery_verifier_v18'),
  ('passkeys','tcds_recovery_verifier_v18'),
  ('user_recovery_contacts','tcds_recovery_otp_v18'),
  ('password_reset_requests','tcds_recovery_otp_v18'),
  ('recovery_contact_challenges_v1','tcds_recovery_otp_v18'),
  ('recovery_proofs_v1','tcds_recovery_otp_v18'),
  ('recovery_claim_bindings_v191','tcds_recovery_otp_v18')) AS v(tbl,role_name)
 LOOP
   IF to_regclass('warehouse_identity.'||req.tbl) IS NULL
   THEN RAISE EXCEPTION 'RLS_GATE_TABLE_MISSING:%',req.tbl; END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=req.role_name)
   THEN RAISE EXCEPTION 'RLS_GATE_ROLE_MISSING:%',req.role_name; END IF;
   IF NOT has_table_privilege(req.role_name,'warehouse_identity.'||req.tbl,'SELECT')
   THEN RAISE EXCEPTION 'RLS_GATE_SELECT_GRANT_MISSING:%:%',req.tbl,req.role_name; END IF;
   SELECT count(*) INTO pol_count FROM pg_policies
    WHERE schemaname='warehouse_identity' AND tablename=req.tbl
      AND req.role_name=ANY(roles) AND cmd IN ('SELECT','ALL');
   IF pol_count=0 THEN RAISE EXCEPTION 'RLS_GATE_POLICY_MISSING:%:%',req.tbl,req.role_name; END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='warehouse_identity'
   AND tablename IN ('recovery_claim_bindings_v191','recovery_proofs_v1') AND 'public'=ANY(roles))
 THEN RAISE EXCEPTION 'RLS_GATE_PUBLIC_RECOVERY_POLICY'; END IF;
END $gate$;
