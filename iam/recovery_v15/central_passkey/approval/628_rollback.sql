-- 628 rollback: restore 624's binding writer exactly as delivered and remove the central approval ceremony.
-- Central approvals already recorded are audit data: if any exist, the rollback refuses unless the session sets
--   SET tcds.r628_delete_central_approvals = 'yes';   (rehearsals only). 623 bindings already written are kept.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
DECLARE n_appr int; n_ctx int;
BEGIN
 SELECT count(*) INTO n_appr FROM warehouse_identity.eoc_binding_approvals_v13 WHERE approval_method = 'CENTRAL_PASSKEY';
 SELECT count(*) INTO n_ctx FROM warehouse_identity.central_challenge_context WHERE purpose = 'EOC_BINDING_APPROVAL';
 IF (n_appr > 0 OR n_ctx > 0) AND coalesce(current_setting('tcds.r628_delete_central_approvals', true), '') <> 'yes' THEN
   RAISE EXCEPTION 'R628_ROLLBACK_REFUSED: % central approvals and % approval challenges exist (audit data)', n_appr, n_ctx;
 END IF;
 DELETE FROM warehouse_identity.eoc_binding_approvals_v13 WHERE approval_method = 'CENTRAL_PASSKEY';
 DELETE FROM warehouse_identity.central_challenge_context WHERE purpose = 'EOC_BINDING_APPROVAL';
END $guard$;
CREATE TEMP TABLE r628_rb ON COMMIT DROP AS
SELECT NOT pg_has_role(current_user, 'tcds_identity_function_owner', 'USAGE') OR NOT pg_has_role(current_user, 'tcds_identity_function_owner', 'SET') AS need,
       (SELECT inherit_option FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS m_inherit,
       (SELECT set_option FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS m_set,
       EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS had;
DO $up$ BEGIN
 IF (SELECT need FROM r628_rb) THEN EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT TRUE, SET TRUE', current_user); END IF;
END $up$;
CREATE OR REPLACE FUNCTION warehouse_identity.eoc_create_binding_v13(
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

DROP FUNCTION IF EXISTS
  warehouse_identity.central_finalize_approval_v1(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid),
  warehouse_identity.central_approval_begin_v1(uuid,text,text,bytea,uuid,uuid),
  warehouse_identity.central_binding_request_info_v1(uuid),
  warehouse_identity.central_cancel_binding_request_v1(uuid),
  warehouse_identity.central_request_binding_v1(uuid,text,text,text,uuid,integer),
  warehouse_identity.central_is_binding_approver_v1(uuid);
DROP POLICY IF EXISTS eoc628_approvals_owner_insert ON warehouse_identity.eoc_binding_approvals_v13;
REVOKE INSERT ON warehouse_identity.eoc_binding_approvals_v13 FROM tcds_identity_function_owner;
ALTER TABLE warehouse_identity.eoc_binding_approvals_v13 DROP CONSTRAINT IF EXISTS eoc_binding_approvals_v13_method_session_check;
ALTER TABLE warehouse_identity.eoc_binding_approvals_v13 DROP COLUMN IF EXISTS approval_method;
ALTER TABLE warehouse_identity.eoc_binding_approvals_v13 ALTER COLUMN auth_session_id SET NOT NULL;
ALTER TABLE warehouse_identity.central_challenge_context DROP CONSTRAINT IF EXISTS central_challenge_context_approval_check;
ALTER TABLE warehouse_identity.central_challenge_context DROP COLUMN IF EXISTS binding_request_id;
ALTER TABLE warehouse_identity.central_challenge_context DROP CONSTRAINT central_challenge_context_purpose_check;
ALTER TABLE warehouse_identity.central_challenge_context ADD CONSTRAINT central_challenge_context_purpose_check
  CHECK (purpose = ANY (ARRAY['CENTRAL_PASSKEY_ENROLLMENT'::text, 'EOC_OIDC_LOGIN'::text]));
DROP TABLE IF EXISTS warehouse_identity.central_binding_requests;
DO $down$ BEGIN
 IF (SELECT need FROM r628_rb) THEN
  IF (SELECT had FROM r628_rb) THEN
   EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT %s, SET %s', current_user,
                  (SELECT m_inherit FROM r628_rb)::text, (SELECT m_set FROM r628_rb)::text);
  ELSE EXECUTE format('REVOKE tcds_identity_function_owner FROM %I', current_user); END IF;
 END IF;
END $down$;
DO $verify$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'warehouse_identity.eoc_create_binding_v13(uuid,uuid,text,text,uuid,uuid,uuid)'::regprocedure)
    <> '131c35ea8937bbbe39c075d835704d0a' THEN RAISE EXCEPTION 'R628_ROLLBACK_WRITER_NOT_RESTORED'; END IF;
 IF to_regclass('warehouse_identity.central_binding_requests') IS NOT NULL THEN RAISE EXCEPTION 'R628_ROLLBACK_INCOMPLETE'; END IF;
END $verify$;
COMMIT;
