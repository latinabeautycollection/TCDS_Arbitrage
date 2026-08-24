-- TCDS DOMAIN 10D reviewed least-privilege patch.

REVOKE ALL ON FUNCTION operations.claim_incident_activation_10d(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.activate_incident_from_notification_10d(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.fail_incident_activation_10d(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.claim_ack_deadlines_10d(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.record_ack_deadline_breach_10d(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.claim_due_incident_escalations_10d(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.prepare_escalation_emission_10d(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.mark_escalation_event_emitted_10d(uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.fail_escalation_emission_10d(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.claim_escalation_settlements_10d(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.settle_escalation_emission_10d(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.apply_incident_command_10d(text,text,text,uuid,text,timestamptz,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.transition_incident_10d(uuid,uuid,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.validate_incident_escalation_binding_for_event_10d(uuid,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.enqueue_incident_activation_10d() FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.incident_actor_authorized_10d(uuid,uuid,boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION operations.claim_incident_activation_10d(text,integer,integer)
TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.activate_incident_from_notification_10d(uuid,text)
TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.fail_incident_activation_10d(uuid,text,text)
TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.claim_ack_deadlines_10d(text,integer,integer)
TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.record_ack_deadline_breach_10d(uuid,text)
TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.claim_due_incident_escalations_10d(text,integer,integer)
TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.prepare_escalation_emission_10d(uuid,text)
TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.mark_escalation_event_emitted_10d(uuid,text,uuid)
TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.fail_escalation_emission_10d(uuid,text,text)
TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.claim_escalation_settlements_10d(text,integer,integer)
TO tcds_operations_incident_executor;
GRANT EXECUTE ON FUNCTION operations.settle_escalation_emission_10d(uuid,text)
TO tcds_operations_incident_executor;

GRANT EXECUTE ON FUNCTION operations.apply_incident_command_10d(
  text,text,text,uuid,text,timestamptz,uuid,text
) TO tcds_operations_incident_command_processor;
GRANT EXECUTE ON FUNCTION operations.transition_incident_10d(
  uuid,uuid,text,text,text,uuid
) TO tcds_operations_incident_command_processor;
