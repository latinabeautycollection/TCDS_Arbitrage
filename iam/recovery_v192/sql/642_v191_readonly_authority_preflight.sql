-- SELECT-only production-safe catalog preflight. Missing = STOP, never infer from ZIP.
SELECT current_database() AS db_name, current_user AS inspected_as, current_setting('server_version') AS postgres_version;
SELECT name,object_oid FROM (VALUES
 ('warehouse_identity.password_reset_requests',to_regclass('warehouse_identity.password_reset_requests')::oid),
 ('warehouse_identity.user_recovery_contacts',to_regclass('warehouse_identity.user_recovery_contacts')::oid),
 ('warehouse_identity.recovery_proofs_v1',to_regclass('warehouse_identity.recovery_proofs_v1')::oid),
 ('warehouse_identity.recovery_contact_challenges_v1',to_regclass('warehouse_identity.recovery_contact_challenges_v1')::oid),
 ('warehouse_identity.recovery_claim_bindings_v191',to_regclass('warehouse_identity.recovery_claim_bindings_v191')::oid),
 ('warehouse_identity.recovery_issuance_jobs_v19',to_regclass('warehouse_identity.recovery_issuance_jobs_v19')::oid),
 ('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)',to_regprocedure('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)')::oid),
 ('warehouse_identity.claim_password_reset_token_v5(uuid,bytea,bytea,bytea,bytea)',to_regprocedure('warehouse_identity.claim_password_reset_token_v5(uuid,bytea,bytea,bytea,bytea)')::oid)
 ) AS v(name,object_oid);
SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner,
 (SELECT count(*) FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname) policy_count
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='warehouse_identity'
 AND c.relname IN ('auth_sessions','employees','password_reset_requests','auth_challenges','passkeys',
   'webauthn_verification_evidence','user_recovery_contacts','recovery_proofs_v1','recovery_claim_bindings_v191')
 ORDER BY c.relname;
SELECT rolname,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname IN
 ('tcds_identity_function_owner','tcds_login_api','tcds_recovery_verifier_v18','tcds_recovery_otp_v18','tcds_recovery_delivery_v18');
