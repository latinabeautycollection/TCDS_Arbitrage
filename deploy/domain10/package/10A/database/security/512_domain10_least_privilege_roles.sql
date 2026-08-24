-- Run as a database owner/security administrator after migrations.
-- Map these NOLOGIN roles to your existing TCDS login roles/users.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_reader') THEN CREATE ROLE tcds_operations_reader NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_worker') THEN CREATE ROLE tcds_operations_worker NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_admin') THEN CREATE ROLE tcds_operations_admin NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_auditor') THEN CREATE ROLE tcds_operations_auditor NOLOGIN; END IF;
END $$;
REVOKE ALL ON SCHEMA operations FROM PUBLIC;
GRANT USAGE ON SCHEMA operations TO tcds_operations_reader,tcds_operations_worker,tcds_operations_admin,tcds_operations_auditor;
GRANT SELECT ON ALL TABLES IN SCHEMA operations TO tcds_operations_reader;
GRANT SELECT ON operations.audit_ledger,operations.operational_events,operations.sms_consent_events,operations.provider_receipts,operations.incident_events,operations.incident_escalation_executions TO tcds_operations_auditor;
GRANT SELECT,INSERT,UPDATE ON operations.notification_deliveries,operations.notification_outbox,operations.delivery_attempts,operations.dead_letters,operations.provider_health,operations.rate_limit_buckets TO tcds_operations_worker;
GRANT SELECT ON operations.notification_requests,operations.notification_recipients,operations.recipient_directory,operations.recipient_authorizations,operations.sms_subscriptions,operations.channel_controls TO tcds_operations_worker;
GRANT EXECUTE ON FUNCTION operations.claim_notification_outbox(text,text,integer,integer) TO tcds_operations_worker;
GRANT EXECUTE ON FUNCTION operations.record_sms_consent_event(text,text,text,text,timestamptz,text,uuid,text,text) TO tcds_operations_worker;
GRANT EXECUTE ON FUNCTION operations.record_provider_acceptance(uuid,uuid,text,text,integer,jsonb) TO tcds_operations_worker;
GRANT EXECUTE ON FUNCTION operations.record_final_delivery(uuid,text,text,jsonb,text,uuid) TO tcds_operations_worker;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA operations TO tcds_operations_admin;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA operations TO tcds_operations_worker,tcds_operations_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA operations REVOKE ALL ON TABLES FROM PUBLIC;
