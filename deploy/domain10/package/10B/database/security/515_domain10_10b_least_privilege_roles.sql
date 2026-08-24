-- Apply after 513 + 514 as database owner/security administrator.

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_ingestor') THEN
    CREATE ROLE tcds_operations_ingestor NOLOGIN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_planner') THEN
    CREATE ROLE tcds_operations_planner NOLOGIN;
  END IF;
END $$;

REVOKE ALL ON SCHEMA operations FROM PUBLIC;
GRANT USAGE ON SCHEMA operations TO tcds_operations_ingestor,tcds_operations_planner;

-- Explicitly remove default PUBLIC execution on SECURITY DEFINER functions.
REVOKE ALL ON FUNCTION operations.ingest_operational_event(
  text,text,text,timestamptz,text,text,text,text,uuid,uuid,text,uuid,integer,text,jsonb,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.begin_notification_decision(
  uuid,uuid,text,uuid,uuid,integer,text,text,jsonb,uuid,text,text,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.seal_notification_decision(uuid) FROM PUBLIC;

GRANT SELECT ON operations.event_sources,operations.event_types,operations.event_contract_versions
  TO tcds_operations_ingestor;
GRANT EXECUTE ON FUNCTION operations.ingest_operational_event(
  text,text,text,timestamptz,text,text,text,text,uuid,uuid,text,uuid,integer,text,jsonb,text
) TO tcds_operations_ingestor;

GRANT SELECT ON
  operations.operational_events,operations.event_sources,operations.event_processing,
  operations.event_contract_versions,operations.notification_policies,
  operations.notification_policy_versions,operations.notification_audiences,
  operations.audience_members,operations.audience_resolution_rules,
  operations.recipient_directory,operations.recipient_authorizations,
  operations.sms_subscriptions,operations.notification_templates,
  operations.notification_template_versions,operations.policy_channel_templates,
  operations.suppression_rules,operations.suppression_decisions,
  operations.notification_decisions,operations.notification_decision_candidates
TO tcds_operations_planner;

GRANT INSERT ON
  operations.notification_decision_candidates,
  operations.notification_requests,operations.notification_recipients,
  operations.notification_deliveries,operations.notification_outbox,
  operations.suppression_decisions,operations.audit_ledger
TO tcds_operations_planner;

-- Direct notification_decisions INSERT is denied; controlled function only.
REVOKE INSERT,UPDATE,DELETE ON operations.notification_decisions FROM tcds_operations_planner;
GRANT EXECUTE ON FUNCTION operations.begin_notification_decision(
  uuid,uuid,text,uuid,uuid,integer,text,text,jsonb,uuid,text,text,text
) TO tcds_operations_planner;
GRANT EXECUTE ON FUNCTION operations.seal_notification_decision(uuid)
  TO tcds_operations_planner;

GRANT SELECT,INSERT,UPDATE ON
  operations.event_processing,operations.event_planning_outbox,operations.event_planning_attempts
TO tcds_operations_planner;

GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA operations TO tcds_operations_planner;

GRANT EXECUTE ON FUNCTION operations.claim_event_planning_outbox(text,integer,integer)
  TO tcds_operations_planner;
GRANT EXECUTE ON FUNCTION operations.begin_event_planning_attempt(uuid,text)
  TO tcds_operations_planner;
GRANT EXECUTE ON FUNCTION operations.complete_event_planning(uuid,uuid,text,text,text)
  TO tcds_operations_planner;
GRANT EXECUTE ON FUNCTION operations.fail_event_planning(uuid,uuid,text,text,text,boolean,timestamptz,integer)
  TO tcds_operations_planner;
GRANT EXECUTE ON FUNCTION operations.resolve_authorized_audience(uuid,text,text,timestamptz)
  TO tcds_operations_planner;
GRANT EXECUTE ON FUNCTION operations.resolve_authoritative_notification_policy(uuid)
  TO tcds_operations_planner;
GRANT EXECUTE ON FUNCTION operations.is_recipient_channel_authorized(uuid,uuid,text,text,timestamptz,text)
  TO tcds_operations_planner;

ALTER DEFAULT PRIVILEGES IN SCHEMA operations REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA operations REVOKE ALL ON FUNCTIONS FROM PUBLIC;
