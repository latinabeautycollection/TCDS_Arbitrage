-- Read-only staging/production comparison. No DDL and no PII values.
SELECT 'warehouse_users' AS object, to_regclass('warehouse_identity.users')::text AS present
UNION ALL SELECT 'warehouse_reset_requests',to_regclass('warehouse_identity.password_reset_requests')::text
UNION ALL SELECT 'warehouse_reset_claim_v5',to_regprocedure('warehouse_identity.claim_password_reset_token_v5(uuid,bytea,bytea,bytea,bytea)')::text
UNION ALL SELECT 'warehouse_reset_consume_v5',to_regprocedure('warehouse_identity.consume_password_reset_v5(uuid,bytea,bytea,text,jsonb,uuid,uuid,uuid)')::text
UNION ALL SELECT 'warehouse_stepup_authorizations',to_regclass('warehouse_identity.password_recovery_stepup_authorizations_v62')::text
UNION ALL SELECT 'leadership_directory',to_regclass('enterprise_org.leadership_people')::text
UNION ALL SELECT 'domain10_notification_queue',to_regclass('operations.notification_requests')::text
UNION ALL SELECT 'eoc_session_authority',to_regclass('eoc_iam.sessions')::text
UNION ALL SELECT 'recovery_contacts_v14',to_regclass('warehouse_identity.user_recovery_contacts')::text
UNION ALL SELECT 'recovery_rate_buckets_v14',to_regclass('warehouse_identity.recovery_rate_buckets_v14')::text;
SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='warehouse_identity' AND c.relname LIKE 'recovery_%' AND c.relkind='r'
ORDER BY c.relname;
