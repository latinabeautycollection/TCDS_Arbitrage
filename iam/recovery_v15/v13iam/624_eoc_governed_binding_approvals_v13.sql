-- CENTRAL IAM DATABASE ONLY, AFTER Praise-certified 623. Not retail DB.
-- WebAuthn verifier remains central; this migration is only the evidence admission + atomic binding writer.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $pre$ BEGIN
 IF to_regprocedure('warehouse_identity.eoc_resolve_federation_v623(text,text,uuid)') IS NULL OR
    to_regclass('warehouse_identity.eoc_federated_subject_bindings_v12') IS NULL OR
    to_regclass('warehouse_identity.webauthn_verification_evidence') IS NULL THEN
  RAISE EXCEPTION 'EOC624_REQUIRES_CERTIFIED_623_AND_WEB_AUTHN'; END IF;
 IF to_regclass('warehouse_identity.eoc_binding_approvals_v13') IS NOT NULL THEN
  RAISE EXCEPTION 'EOC624_ALREADY_INSTALLED'; END IF;
END $pre$;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_eoc_attestation_writer') THEN CREATE ROLE tcds_eoc_attestation_writer NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_eoc_binding_admin') THEN CREATE ROLE tcds_eoc_binding_admin NOLOGIN; END IF;
END$$;
CREATE TABLE warehouse_identity.eoc_binding_approvals_v13 (
 evidence_id uuid PRIMARY KEY, request_id uuid NOT NULL, binding_id uuid NOT NULL,
 approver_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 auth_session_id uuid NOT NULL REFERENCES warehouse_identity.auth_sessions(auth_session_id),
 web_authn_evidence_id uuid NOT NULL UNIQUE REFERENCES warehouse_identity.webauthn_verification_evidence(webauthn_verification_evidence_id),
 target_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 oidc_issuer text NOT NULL CHECK (oidc_issuer LIKE 'https://%'),
 subject_hash text NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
 verified_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 verifier_digest text NOT NULL CHECK (verifier_digest ~ '^[0-9a-f]{64}$'),
 ceremony_id uuid NOT NULL UNIQUE, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(approver_user_id <> target_user_id),
 CHECK(expires_at>verified_at AND expires_at<=verified_at+interval '5 minutes')
);
CREATE INDEX eoc_binding_approvals_request_v13_idx ON warehouse_identity.eoc_binding_approvals_v13(request_id,binding_id);
CREATE TABLE warehouse_identity.eoc_binding_admin_audit_v13 (
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 request_id uuid NOT NULL, target_user_id uuid NOT NULL,
 binding_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('BIND_VERIFIED','BIND_REVOKED')),
 first_approver uuid NOT NULL, second_approver uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE warehouse_identity.eoc_binding_approvals_v13 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.eoc_binding_approvals_v13 FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.eoc_binding_admin_audit_v13 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.eoc_binding_admin_audit_v13 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.eoc_binding_approvals_v13,warehouse_identity.eoc_binding_admin_audit_v13 FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA warehouse_identity TO tcds_eoc_attestation_writer,tcds_eoc_binding_admin;
-- The capability is explicit, never automatically assigned to supervisors or executives.
INSERT INTO warehouse_identity.roles(role_code,role_name,permissions,active)
SELECT 'EOC_IDENTITY_BINDING_APPROVER','EOC Federation Identity Binding Approver',
 ARRAY['enterprise:identity:eoc_binding:approve']::text[],true
WHERE NOT EXISTS(SELECT 1 FROM warehouse_identity.roles WHERE role_code='EOC_IDENTITY_BINDING_APPROVER');
GRANT INSERT ON warehouse_identity.eoc_binding_approvals_v13 TO tcds_eoc_attestation_writer;
CREATE POLICY eoc624_attest_insert ON warehouse_identity.eoc_binding_approvals_v13
 FOR INSERT TO tcds_eoc_attestation_writer WITH CHECK(consumed_at IS NULL AND expires_at>clock_timestamp() AND verified_at<=clock_timestamp());
-- Reuse 623's function-owner role, not another credential or principal authority.
GRANT SELECT,UPDATE(consumed_at) ON warehouse_identity.eoc_binding_approvals_v13 TO tcds_identity_function_owner;
GRANT INSERT ON warehouse_identity.eoc_binding_admin_audit_v13 TO tcds_identity_function_owner;
GRANT USAGE ON SEQUENCE warehouse_identity.eoc_binding_admin_audit_v13_audit_id_seq TO tcds_identity_function_owner;
GRANT INSERT,UPDATE ON warehouse_identity.eoc_federated_subject_bindings_v12 TO tcds_identity_function_owner;
-- Minimal cross-table attributes used for point-in-time approver re-authorization.
GRANT SELECT(user_id,status,archived_at) ON warehouse_identity.users TO tcds_identity_function_owner;
GRANT SELECT(auth_session_id,user_id,assurance_level,restricted_session,revoked_at,idle_expires_at,absolute_expires_at)
 ON warehouse_identity.auth_sessions TO tcds_identity_function_owner;
GRANT SELECT(webauthn_verification_evidence_id,user_id,user_verified,verified_at)
 ON warehouse_identity.webauthn_verification_evidence TO tcds_identity_function_owner;
GRANT SELECT(user_id,role_id,revoked_at,valid_from,valid_until,facility_id,station_id)
 ON warehouse_identity.user_role_assignments TO tcds_identity_function_owner;
GRANT SELECT(role_id,active,permissions) ON warehouse_identity.roles TO tcds_identity_function_owner;
CREATE POLICY eoc624_fn_auth_sessions_read ON warehouse_identity.auth_sessions
 FOR SELECT TO tcds_identity_function_owner USING(true);
CREATE POLICY eoc624_fn_webauthn_read ON warehouse_identity.webauthn_verification_evidence
 FOR SELECT TO tcds_identity_function_owner USING(true);

CREATE POLICY eoc624_approvals_owner_read ON warehouse_identity.eoc_binding_approvals_v13 FOR SELECT TO tcds_identity_function_owner USING(true);
CREATE POLICY eoc624_approvals_owner_update ON warehouse_identity.eoc_binding_approvals_v13 FOR UPDATE TO tcds_identity_function_owner USING(true) WITH CHECK(true);
CREATE POLICY eoc624_audit_owner_insert ON warehouse_identity.eoc_binding_admin_audit_v13 FOR INSERT TO tcds_identity_function_owner WITH CHECK(true);
CREATE POLICY eoc624_binding_owner_insert ON warehouse_identity.eoc_federated_subject_bindings_v12 FOR INSERT TO tcds_identity_function_owner WITH CHECK(true);
CREATE POLICY eoc624_binding_owner_update ON warehouse_identity.eoc_federated_subject_bindings_v12 FOR UPDATE TO tcds_identity_function_owner USING(true) WITH CHECK(true);
-- Temporary role membership for Supabase PG17 ownership change, as used by certified 623.
CREATE TEMP TABLE eoc624_role_state ON COMMIT DROP AS
 SELECT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member=current_user::regrole) AS had_member,
 (SELECT inherit_option FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member=current_user::regrole LIMIT 1) AS orig_inherit,
 (SELECT set_option FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member=current_user::regrole LIMIT 1) AS orig_set,
 pg_has_role(current_user,'tcds_identity_function_owner','SET') AS had_set;
DO $$BEGIN
 IF NOT (SELECT had_set FROM eoc624_role_state) THEN
  EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT TRUE, SET TRUE',current_user);
 END IF;
END$$;
CREATE FUNCTION warehouse_identity.eoc_create_binding_v13(
 p_binding uuid,p_target uuid,p_issuer text,p_subject_hash text,p_request uuid,p_first uuid,p_second uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_count int;v_now timestamptz:=clock_timestamp();
BEGIN
 IF p_binding IS NULL OR p_target IS NULL OR p_request IS NULL OR p_first IS NULL OR p_second IS NULL
  OR p_first=p_second OR p_first=p_target OR p_second=p_target OR p_issuer NOT LIKE 'https://%'
  OR p_subject_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'BINDING_APPROVAL_INVALID' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM warehouse_identity.eoc_binding_approvals_v13 a
 WHERE a.binding_id=p_binding AND a.request_id=p_request ORDER BY a.evidence_id FOR UPDATE;
 SELECT count(DISTINCT approver_user_id) INTO v_count FROM warehouse_identity.eoc_binding_approvals_v13
 WHERE binding_id=p_binding AND request_id=p_request AND target_user_id=p_target
  AND oidc_issuer=p_issuer AND subject_hash=p_subject_hash
  AND approver_user_id IN (p_first,p_second) AND consumed_at IS NULL AND expires_at>v_now AND verified_at<=v_now;
 -- Reevaluate BOTH approvers' central IAM authorization at the moment of binding creation.
 IF (SELECT count(DISTINCT u.user_id)
   FROM warehouse_identity.eoc_binding_approvals_v13 a
   JOIN warehouse_identity.users u ON u.user_id=a.approver_user_id AND u.status='ACTIVE' AND u.archived_at IS NULL
   JOIN warehouse_identity.auth_sessions sess ON sess.auth_session_id=a.auth_session_id AND sess.user_id=u.user_id
    AND sess.assurance_level='AAL2' AND sess.restricted_session=false AND sess.revoked_at IS NULL
    AND sess.idle_expires_at>v_now AND sess.absolute_expires_at>v_now
   JOIN warehouse_identity.webauthn_verification_evidence ev ON ev.webauthn_verification_evidence_id=a.web_authn_evidence_id
    AND ev.user_id=u.user_id AND ev.user_verified=true AND ev.verified_at BETWEEN v_now-interval '5 minutes' AND v_now
   JOIN warehouse_identity.user_role_assignments ra ON ra.user_id=u.user_id AND ra.revoked_at IS NULL
    AND ra.valid_from<=v_now AND (ra.valid_until IS NULL OR ra.valid_until>v_now) AND ra.facility_id IS NULL AND ra.station_id IS NULL
   JOIN warehouse_identity.roles rol ON rol.role_id=ra.role_id AND rol.active=true
    AND 'enterprise:identity:eoc_binding:approve'=ANY(rol.permissions)
   WHERE a.binding_id=p_binding AND a.request_id=p_request AND a.target_user_id=p_target
    AND a.oidc_issuer=p_issuer AND a.subject_hash=p_subject_hash
    AND a.approver_user_id IN(p_first,p_second) AND a.consumed_at IS NULL AND a.expires_at>v_now)<>2
 THEN RAISE EXCEPTION 'BINDING_APPROVER_REVOKED_OR_UNVERIFIED' USING ERRCODE='42501'; END IF;
 IF v_count<>2 OR (SELECT count(*) FROM warehouse_identity.eoc_binding_approvals_v13
  WHERE binding_id=p_binding AND request_id=p_request AND target_user_id=p_target
   AND oidc_issuer=p_issuer AND subject_hash=p_subject_hash
   AND approver_user_id IN (p_first,p_second) AND consumed_at IS NULL AND expires_at>v_now AND verified_at<=v_now)<>2
 THEN RAISE EXCEPTION 'TWO_FRESH_ATTESTATIONS_REQUIRED' USING ERRCODE='42501'; END IF;
 UPDATE warehouse_identity.eoc_binding_approvals_v13 SET consumed_at=v_now
 WHERE binding_id=p_binding AND request_id=p_request AND target_user_id=p_target
  AND oidc_issuer=p_issuer AND subject_hash=p_subject_hash AND approver_user_id IN (p_first,p_second)
  AND consumed_at IS NULL AND expires_at>v_now;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_REPLAY' USING ERRCODE='42501'; END IF;
 INSERT INTO warehouse_identity.eoc_federated_subject_bindings_v12
 (binding_id,issuer,subject_hash,user_id,binding_status,evidence_reference,approved_by,secondary_approved_by,verified_at)
 VALUES(p_binding,p_issuer,p_subject_hash,p_target,'VERIFIED','EOC_V13_TWO_WEB_AUTHN_ATTESTATIONS:'||p_request::text,p_first,p_second,v_now);
 INSERT INTO warehouse_identity.eoc_binding_admin_audit_v13(request_id,target_user_id,binding_id,action,first_approver,second_approver)
 VALUES(p_request,p_target,p_binding,'BIND_VERIFIED',p_first,p_second);
 RETURN p_binding;
END $fn$;
ALTER FUNCTION warehouse_identity.eoc_create_binding_v13(uuid,uuid,text,text,uuid,uuid,uuid) OWNER TO tcds_identity_function_owner;
REVOKE ALL ON FUNCTION warehouse_identity.eoc_create_binding_v13(uuid,uuid,text,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION warehouse_identity.eoc_create_binding_v13(uuid,uuid,text,text,uuid,uuid,uuid) TO tcds_eoc_binding_admin;
DO $$BEGIN
 IF NOT (SELECT had_member FROM eoc624_role_state) THEN
  EXECUTE format('REVOKE tcds_identity_function_owner FROM %I',current_user);
 ELSIF NOT (SELECT had_set FROM eoc624_role_state) THEN
  EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT %s, SET %s',current_user,
   CASE WHEN (SELECT orig_inherit FROM eoc624_role_state) THEN 'TRUE' ELSE 'FALSE' END,
   CASE WHEN (SELECT orig_set FROM eoc624_role_state) THEN 'TRUE' ELSE 'FALSE' END);
 END IF;
END$$;
COMMIT;
