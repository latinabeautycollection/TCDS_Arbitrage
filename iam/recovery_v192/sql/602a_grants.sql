-- Slice 6.2 addendum: the rewritten approve_password_reset_v3 runs as tcds_identity_function_owner
-- (SECURITY DEFINER) and reads/locks/writes the new step-up tables, which are owned by postgres.
-- Without these grants an approval fails with "permission denied" instead of FRESH_STEP_UP_REQUIRED.
-- (SELECT ... FOR UPDATE needs UPDATE privilege.)
GRANT SELECT, UPDATE ON warehouse_identity.password_recovery_stepup_authorizations_v62 TO tcds_identity_function_owner;
GRANT SELECT, INSERT ON warehouse_identity.password_recovery_stepup_uses_v62 TO tcds_identity_function_owner;

DO $verify$
BEGIN
 IF NOT (has_table_privilege('tcds_identity_function_owner','warehouse_identity.password_recovery_stepup_authorizations_v62','SELECT')
     AND has_table_privilege('tcds_identity_function_owner','warehouse_identity.password_recovery_stepup_authorizations_v62','UPDATE')
     AND has_table_privilege('tcds_identity_function_owner','warehouse_identity.password_recovery_stepup_uses_v62','SELECT')
     AND has_table_privilege('tcds_identity_function_owner','warehouse_identity.password_recovery_stepup_uses_v62','INSERT')) THEN
  RAISE EXCEPTION 'SLICE_6_2A_GRANTS_MISSING';
 END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='warehouse_identity' AND c.relname LIKE 'password_recovery_%v62') <> 3 THEN
  RAISE EXCEPTION 'SLICE_6_2_TABLES_MISSING';
 END IF;
 IF position('FRESH_STEP_UP_REQUIRED' IN pg_get_functiondef(
     'warehouse_identity.approve_password_reset_v3(uuid,uuid,bigint,bytea,timestamptz)'::regprocedure)) = 0 THEN
  RAISE EXCEPTION 'SLICE_6_2_V3_NOT_REWRITTEN';
 END IF;
 IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=
     'warehouse_identity.approve_password_reset_v3(uuid,uuid,bigint,bytea,timestamptz)'::regprocedure)) <> 'tcds_identity_function_owner' THEN
  RAISE EXCEPTION 'SLICE_6_2_V3_OWNER_CHANGED';
 END IF;
END $verify$;
