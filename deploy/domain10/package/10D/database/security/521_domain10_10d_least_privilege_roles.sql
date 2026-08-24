DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_incident_executor') THEN CREATE ROLE tcds_operations_incident_executor NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_incident_command_processor') THEN CREATE ROLE tcds_operations_incident_command_processor NOLOGIN; END IF;
END $$;
REVOKE ALL ON SCHEMA operations FROM PUBLIC;
GRANT USAGE ON SCHEMA operations TO tcds_operations_incident_executor,tcds_operations_incident_command_processor;

GRANT SELECT ON operations.notification_requests,operations.notification_decisions,operations.notification_deliveries,operations.operational_events,
 operations.incidents,operations.incident_escalations,operations.incident_escalation_executions,operations.incident_acknowledgements,
 operations.incident_activation_queue_10d,operations.incident_escalation_runtime_10d,operations.incident_escalation_emissions_10d,
 operations.incident_ack_deadlines_10d,operations.incident_escalation_plan_snapshots_10d,operations.incident_escalation_bindings_10d
TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.claim_incident_activation_10d(text,integer,integer) TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.activate_incident_from_notification_10d(uuid,text) TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.fail_incident_activation_10d(uuid,text,text) TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.claim_ack_deadlines_10d(text,integer,integer) TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.record_ack_deadline_breach_10d(uuid,text) TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.claim_due_incident_escalations_10d(text,integer,integer) TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.prepare_escalation_emission_10d(uuid,text) TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.mark_escalation_event_emitted_10d(uuid,text,uuid) TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.fail_escalation_emission_10d(uuid,text,text) TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.claim_escalation_settlements_10d(text,integer,integer) TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.settle_escalation_emission_10d(uuid,text) TO tcds_operations_incident_executor;

GRANT SELECT ON operations.recipient_directory TO tcds_operations_incident_command_processor;
GRANT EXECUTE ON FUNCTION operations.apply_incident_command_10d(text,text,text,uuid,text,timestamptz,uuid,text) TO tcds_operations_incident_command_processor;
GRANT EXECUTE ON FUNCTION operations.transition_incident_10d(uuid,uuid,text,text,text,uuid) TO tcds_operations_incident_command_processor;

REVOKE ALL ON FUNCTION operations.apply_incident_command_10d(text,text,text,uuid,text,timestamptz,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.transition_incident_10d(uuid,uuid,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.activate_incident_from_notification_10d(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.prepare_escalation_emission_10d(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.settle_escalation_emission_10d(uuid,text) FROM PUBLIC;
