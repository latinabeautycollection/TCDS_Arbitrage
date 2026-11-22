-- V1.9 read-only staging preflight. Returns facts; it DOES NOT certify security.
SELECT current_database() AS database_name, current_user AS checked_as, current_setting('server_version') AS pg_version;
SELECT name,to_regclass(name) IS NOT NULL AS installed FROM (VALUES
 ('warehouse_identity.password_reset_requests'),('warehouse_identity.user_recovery_contacts'),
 ('warehouse_identity.recovery_contact_challenges_v1'),('warehouse_identity.recovery_proofs_v1'),
 ('warehouse_identity.recovery_action_challenges_v18'),('warehouse_identity.recovery_secret_outbox_v18'),
 ('warehouse_identity.recovery_invitation_refs_v18'),('warehouse_identity.recovery_issuance_jobs_v19'),
 ('warehouse_audit.security_events'),('warehouse_telemetry.warehouse_activity_events'),
 ('operations.operational_events')
) AS t(name);
SELECT signature,to_regprocedure(signature) IS NOT NULL AS installed FROM (VALUES
 ('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'),
 ('warehouse_identity.consume_password_reset_v5(uuid,bytea,bytea,text,jsonb,uuid,uuid,uuid)'),
 ('warehouse_identity.iam_advance_session_epoch_v15(uuid,text,uuid,uuid,uuid)'),
 ('warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text)')
) AS t(signature);
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='warehouse_identity' AND c.relname LIKE 'recovery_%_v1%' ORDER BY c.relname;
SELECT rolname,rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname IN
 ('tcds_login_api','tcds_identity_function_owner','tcds_recovery_otp_v18',
  'tcds_recovery_verifier_v18','tcds_recovery_delivery_v18');
-- Privilege probes require a separate SET ROLE test for actual effective permissions.
