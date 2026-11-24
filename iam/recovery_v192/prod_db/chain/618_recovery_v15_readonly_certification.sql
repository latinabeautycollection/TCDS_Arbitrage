-- READ ONLY: evidence helper; output must be retained with commit SHA and DB fingerprint.
-- It does not approve production deployment or mutate any data.
SELECT current_database() AS database_name, session_user AS db_session_user,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='warehouse_identity') AS iam_tables,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='enterprise_org') AS org_tables,
 to_regprocedure('warehouse_identity.consume_password_reset_v5(uuid,bytea,bytea,text,jsonb,uuid,uuid,uuid)') AS existing_password_writer,
 to_regclass('warehouse_identity.iam_session_epochs_v15') AS epoch_table,
 to_regclass('warehouse_identity.user_recovery_contacts') AS recovery_contacts,
 to_regclass('operations.notification_requests') AS domain10_notification_queue,
 to_regclass('eoc_iam.sessions') AS eoc_session_table;
SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,
 has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
 has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
 has_table_privilege('service_role',c.oid,'SELECT') AS service_role_select
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='warehouse_identity'
 AND c.relkind='r' AND (c.relname LIKE 'recovery_%' OR c.relname IN ('user_recovery_contacts','iam_session_epochs_v15'))
ORDER BY c.relname;
SELECT rolname,rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname='iam_recovery_runtime';
