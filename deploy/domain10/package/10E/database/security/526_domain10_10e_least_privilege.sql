-- TCDS Domain 10E least privilege. Run as database owner/security administrator.

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_assurance_evaluator') THEN
    CREATE ROLE tcds_operations_assurance_evaluator NOLOGIN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_assurance_emitter') THEN
    CREATE ROLE tcds_operations_assurance_emitter NOLOGIN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_assurance_reader') THEN
    CREATE ROLE tcds_operations_assurance_reader NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA operations TO
  tcds_operations_assurance_evaluator,
  tcds_operations_assurance_emitter,
  tcds_operations_assurance_reader;

-- Evaluator reads source truth but has no direct source-table mutation.
GRANT SELECT ON
  operations.notification_deliveries,
  operations.delivery_attempts,
  operations.dead_letters,
  operations.provider_health,
  operations.incidents,
  operations.notification_requests,
  operations.incident_acknowledgements,
  operations.incident_escalation_emissions_10d,
  operations.communication_assurance_policies_10e,
  operations.communication_assurance_policy_versions_10e,
  operations.communication_assurance_runs_10e,
  operations.communication_assurance_episodes_10e
TO tcds_operations_assurance_evaluator;

GRANT EXECUTE ON FUNCTION operations.schedule_due_assurance_runs_10e(timestamptz)
TO tcds_operations_assurance_evaluator;
GRANT EXECUTE ON FUNCTION operations.claim_assurance_runs_10e(text,integer,integer)
TO tcds_operations_assurance_evaluator;
GRANT EXECUTE ON FUNCTION operations.evaluate_assurance_run_10e(uuid,text)
TO tcds_operations_assurance_evaluator;
GRANT EXECUTE ON FUNCTION operations.fail_assurance_run_10e(uuid,text,text,text)
TO tcds_operations_assurance_evaluator;

GRANT SELECT ON
  operations.communication_assurance_events_10e
TO tcds_operations_assurance_emitter;
GRANT EXECUTE ON FUNCTION operations.claim_assurance_events_10e(text,integer,integer)
TO tcds_operations_assurance_emitter;
GRANT EXECUTE ON FUNCTION operations.mark_assurance_event_emitted_10e(uuid,text,uuid)
TO tcds_operations_assurance_emitter;
GRANT EXECUTE ON FUNCTION operations.fail_assurance_event_emission_10e(uuid,text,text,integer)
TO tcds_operations_assurance_emitter;

GRANT SELECT ON
  operations.communication_assurance_policies_10e,
  operations.communication_assurance_policy_versions_10e,
  operations.communication_assurance_runs_10e,
  operations.communication_assurance_episodes_10e,
  operations.communication_assurance_events_10e,
  operations.communication_assurance_current_10e,
  operations.communication_assurance_active_breaches_10e
TO tcds_operations_assurance_reader;

REVOKE ALL ON FUNCTION operations.schedule_due_assurance_runs_10e(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.claim_assurance_runs_10e(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.evaluate_assurance_run_10e(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.fail_assurance_run_10e(uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.update_assurance_episode_10e(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.claim_assurance_events_10e(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.mark_assurance_event_emitted_10e(uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.fail_assurance_event_emission_10e(uuid,text,text,integer) FROM PUBLIC;
