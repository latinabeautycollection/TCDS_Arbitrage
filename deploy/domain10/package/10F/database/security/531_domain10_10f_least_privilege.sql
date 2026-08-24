DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_certifier_10f') THEN
    CREATE ROLE tcds_operations_certifier_10f NOLOGIN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_certification_attestor_10f') THEN
    CREATE ROLE tcds_operations_certification_attestor_10f NOLOGIN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_operations_certification_reader_10f') THEN
    CREATE ROLE tcds_operations_certification_reader_10f NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA operations TO
 tcds_operations_certifier_10f,tcds_operations_certification_attestor_10f,tcds_operations_certification_reader_10f;

-- Certifier receives read-only access to 10A-10E evidence. No prior-slice DML.
GRANT SELECT ON
 operations.operational_events,operations.event_sources,operations.audit_ledger,
 operations.notification_requests,operations.notification_recipients,operations.notification_deliveries,
 operations.delivery_attempts,operations.notification_outbox,operations.provider_receipts,operations.dead_letters,
 operations.notification_decisions,operations.notification_decision_candidates,
 operations.delivery_reconciliation_tasks_10c,operations.incidents,operations.incident_acknowledgements,
 operations.incident_ack_deadlines_10d,operations.incident_escalation_emissions_10d,
 operations.communication_assurance_runs_10e,operations.communication_assurance_episodes_10e,
 operations.communication_assurance_events_10e,
 operations.domain10_certification_profiles_10f,operations.domain10_certification_profile_versions_10f,
 operations.domain10_certification_profile_checks_10f,operations.domain10_certification_profile_attestations_10f,
 operations.domain10_certification_runs_10f,operations.domain10_certification_check_results_10f,
 operations.domain10_certification_attestations_10f,operations.domain10_certification_summary_10f
TO tcds_operations_certifier_10f;

GRANT EXECUTE ON FUNCTION operations.begin_domain10_certification_run_10f(text,integer,text,text,text,timestamptz,timestamptz,text,uuid,text)
TO tcds_operations_certifier_10f;
GRANT EXECUTE ON FUNCTION operations.execute_domain10_certification_run_10f(uuid,text)
TO tcds_operations_certifier_10f;
GRANT EXECUTE ON FUNCTION operations.finalize_domain10_certification_run_10f(uuid,text)
TO tcds_operations_certifier_10f;

GRANT SELECT ON operations.domain10_certification_runs_10f,
 operations.domain10_certification_profile_attestations_10f,
 operations.domain10_certification_attestations_10f,
 operations.domain10_certification_summary_10f
TO tcds_operations_certification_attestor_10f;
GRANT EXECUTE ON FUNCTION operations.record_domain10_certification_attestation_10f(uuid,text,text,text,text,text,text,text)
TO tcds_operations_certification_attestor_10f;

GRANT SELECT ON operations.domain10_certification_runs_10f,
 operations.domain10_certification_check_results_10f,
 operations.domain10_certification_attestations_10f,
 operations.domain10_certification_summary_10f
TO tcds_operations_certification_reader_10f;

-- Controlled API only.
REVOKE ALL ON FUNCTION operations.freeze_domain10_certification_profile_10f(uuid,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.compute_domain10_schema_fingerprint_10f() FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.begin_domain10_certification_run_10f(text,integer,text,text,text,timestamptz,timestamptz,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.evaluate_domain10_certification_check_10f(uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.execute_domain10_certification_run_10f(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.record_domain10_certification_attestation_10f(uuid,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.finalize_domain10_certification_run_10f(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.guard_domain10_certification_profile_10f() FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.guard_domain10_certification_run_10f() FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.deny_domain10_certification_evidence_mutation_10f() FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.verify_domain10_certification_evidence_hash_10f() FROM PUBLIC;
