-- ============================================================================
-- TCDS DOMAIN 10F — REVIEWED PRIVILEGE LOCKDOWN
-- ============================================================================

REVOKE ALL ON FUNCTION operations.evaluate_domain10_certification_check_10f_v1(
  uuid,text,integer
) FROM PUBLIC;

REVOKE ALL ON FUNCTION operations.compute_domain10_security_fingerprint_10f()
FROM PUBLIC;

REVOKE ALL ON FUNCTION operations.compute_domain10_schema_fingerprint_10f()
FROM PUBLIC;

REVOKE ALL ON FUNCTION operations.evaluate_domain10_certification_check_10f(
  uuid,text,integer
) FROM PUBLIC;

REVOKE ALL ON FUNCTION operations.freeze_domain10_certification_profile_10f(
  uuid,integer,text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION operations.begin_domain10_certification_run_10f(
  text,integer,text,text,text,timestamptz,timestamptz,text,uuid,text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION operations.execute_domain10_certification_run_10f(
  uuid,text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION operations.record_domain10_certification_attestation_10f(
  uuid,text,text,text,text,text,text,text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION operations.finalize_domain10_certification_run_10f(
  uuid,text
) FROM PUBLIC;

-- Certifier remains read/certification-only. No prior-slice execution grants.
GRANT EXECUTE ON FUNCTION operations.begin_domain10_certification_run_10f(
  text,integer,text,text,text,timestamptz,timestamptz,text,uuid,text
) TO tcds_operations_certifier_10f;

GRANT EXECUTE ON FUNCTION operations.execute_domain10_certification_run_10f(
  uuid,text
) TO tcds_operations_certifier_10f;

GRANT EXECUTE ON FUNCTION operations.finalize_domain10_certification_run_10f(
  uuid,text
) TO tcds_operations_certifier_10f;

GRANT EXECUTE ON FUNCTION operations.record_domain10_certification_attestation_10f(
  uuid,text,text,text,text,text,text,text
) TO tcds_operations_certification_attestor_10f;

-- Explicit negative grants: certification roles do not execute prior-slice
-- business/provider commands.
REVOKE ALL ON FUNCTION operations.record_provider_acceptance_10c(
  uuid,uuid,text,text,text,integer,jsonb
) FROM tcds_operations_certifier_10f,tcds_operations_certification_attestor_10f;

REVOKE ALL ON FUNCTION operations.apply_telnyx_delivery_event_10c(
  text,text,text,timestamptz,text,jsonb,jsonb,uuid
) FROM tcds_operations_certifier_10f,tcds_operations_certification_attestor_10f;

REVOKE ALL ON FUNCTION operations.apply_incident_command_10d(
  text,text,text,uuid,text,timestamptz,uuid,text
) FROM tcds_operations_certifier_10f,tcds_operations_certification_attestor_10f;

REVOKE ALL ON FUNCTION operations.evaluate_assurance_run_10e(
  uuid,text
) FROM tcds_operations_certifier_10f,tcds_operations_certification_attestor_10f;
