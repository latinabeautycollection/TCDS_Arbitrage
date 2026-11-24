-- Rollback of vendor 624 + 625 (+ our wrapper). Refuses while any V1.3 row exists (no data loss).
-- Revokes exactly the privileges 624/625 granted (v13_pre.sql proved none of them existed before).
DO $guard$
DECLARE n bigint := 0; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['eoc_binding_approvals_v13', 'eoc_binding_admin_audit_v13', 'eoc_bridge_audit_archive_v13',
                           'eoc_bridge_legal_holds_v13', 'eoc_bridge_retention_runs_v13'] LOOP
    IF to_regclass('warehouse_identity.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT %s + count(*) FROM warehouse_identity.%I', n, t) INTO n;
    END IF;
  END LOOP;
  IF n > 0 THEN RAISE EXCEPTION 'V13_ROLLBACK_REFUSED_DATA_PRESENT (% rows)', n; END IF;
  IF EXISTS (SELECT 1 FROM warehouse_identity.user_role_assignments ura JOIN warehouse_identity.roles r ON r.role_id = ura.role_id
             WHERE r.role_code = 'EOC_IDENTITY_BINDING_APPROVER') THEN
    RAISE EXCEPTION 'V13_ROLLBACK_REFUSED_APPROVER_ROLE_ASSIGNED';
  END IF;
END $guard$;

DROP FUNCTION IF EXISTS warehouse_identity.eoc_create_binding_v13(uuid, uuid, text, text, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS warehouse_identity.eoc_bridge_retention_batch_v13(integer);
DROP TABLE IF EXISTS warehouse_identity.eoc_binding_approvals_v13, warehouse_identity.eoc_binding_admin_audit_v13,
  warehouse_identity.eoc_bridge_audit_archive_v13, warehouse_identity.eoc_bridge_legal_holds_v13,
  warehouse_identity.eoc_bridge_retention_runs_v13;
DROP FUNCTION IF EXISTS warehouse_identity.eoc_bridge_hold_serial_lock_v13();
DROP INDEX IF EXISTS warehouse_identity.eoc_bridge_audit_time_v13;

DROP POLICY IF EXISTS eoc624_fn_auth_sessions_read ON warehouse_identity.auth_sessions;
DROP POLICY IF EXISTS eoc624_fn_webauthn_read ON warehouse_identity.webauthn_verification_evidence;
DROP POLICY IF EXISTS eoc624_binding_owner_insert ON warehouse_identity.eoc_federated_subject_bindings_v12;
DROP POLICY IF EXISTS eoc624_binding_owner_update ON warehouse_identity.eoc_federated_subject_bindings_v12;
DROP POLICY IF EXISTS eoc625_audit_owner_read ON warehouse_identity.eoc_bridge_audit_v12;
DROP POLICY IF EXISTS eoc625_audit_owner_delete ON warehouse_identity.eoc_bridge_audit_v12;
DROP POLICY IF EXISTS eoc625_audit_owner_update_lock ON warehouse_identity.eoc_bridge_audit_v12;

REVOKE INSERT, UPDATE ON warehouse_identity.eoc_federated_subject_bindings_v12 FROM tcds_identity_function_owner;
REVOKE SELECT, DELETE, UPDATE ON warehouse_identity.eoc_bridge_audit_v12 FROM tcds_identity_function_owner;
REVOKE SELECT (user_id, status, archived_at) ON warehouse_identity.users FROM tcds_identity_function_owner;
REVOKE SELECT (auth_session_id, user_id, assurance_level, restricted_session, revoked_at, idle_expires_at, absolute_expires_at)
  ON warehouse_identity.auth_sessions FROM tcds_identity_function_owner;
REVOKE SELECT (webauthn_verification_evidence_id, user_id, user_verified, verified_at)
  ON warehouse_identity.webauthn_verification_evidence FROM tcds_identity_function_owner;
REVOKE SELECT (user_id, role_id, revoked_at, valid_from, valid_until, facility_id, station_id)
  ON warehouse_identity.user_role_assignments FROM tcds_identity_function_owner;
REVOKE SELECT (role_id, active, permissions) ON warehouse_identity.roles FROM tcds_identity_function_owner;

DELETE FROM warehouse_identity.roles WHERE role_code = 'EOC_IDENTITY_BINDING_APPROVER';

DO $roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['tcds_eoc_attestation_writer', 'tcds_eoc_binding_admin', 'tcds_eoc_audit_retention_worker',
                           'tcds_eoc_legal_hold_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE USAGE ON SCHEMA warehouse_identity FROM %I', r);
      EXECUTE format('DROP ROLE %I', r);
    END IF;
  END LOOP;
END $roles$;
