-- TCDS DOMAIN 10E — REVIEWED PRIVILEGE LOCKDOWN (528)
REVOKE ALL ON FUNCTION operations.calculate_assurance_metric_10e(text,text,text,timestamptz,timestamptz,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.update_assurance_episode_10e(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.validate_assurance_policy_semantics_10e() FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.schedule_due_assurance_runs_10e(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.claim_assurance_runs_10e(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.evaluate_assurance_run_10e(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.fail_assurance_run_10e(uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.claim_assurance_events_10e(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.mark_assurance_event_emitted_10e(uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.fail_assurance_event_emission_10e(uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.schedule_due_assurance_runs_10e(timestamptz) TO tcds_operations_assurance_evaluator;
GRANT EXECUTE ON FUNCTION operations.claim_assurance_runs_10e(text,integer,integer) TO tcds_operations_assurance_evaluator;
GRANT EXECUTE ON FUNCTION operations.evaluate_assurance_run_10e(uuid,text) TO tcds_operations_assurance_evaluator;
GRANT EXECUTE ON FUNCTION operations.fail_assurance_run_10e(uuid,text,text,text) TO tcds_operations_assurance_evaluator;
GRANT EXECUTE ON FUNCTION operations.claim_assurance_events_10e(text,integer,integer) TO tcds_operations_assurance_emitter;
GRANT EXECUTE ON FUNCTION operations.mark_assurance_event_emitted_10e(uuid,text,uuid) TO tcds_operations_assurance_emitter;
GRANT EXECUTE ON FUNCTION operations.fail_assurance_event_emission_10e(uuid,text,text,integer) TO tcds_operations_assurance_emitter;
