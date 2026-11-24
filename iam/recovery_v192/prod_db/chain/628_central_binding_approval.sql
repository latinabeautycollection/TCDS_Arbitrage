-- 628 - ours (TCDS production engineering). STAGING FIRST. Binding approval with the central laptop passkey.
-- Dev team (2026-11-18): do the staging pilot ourselves; we chose that the two binding approvers approve with the same
-- central laptop passkey ceremony as sign-in, instead of a device-bound Warehouse AAL2 session (624 as delivered).
-- Requires 626 (central passkey ceremony) and 624 (V1.3 binding approvals). Changes:
--   central_binding_requests          one binding request: person, issuer, opaque subject hash, binding id, purpose
--   central_challenge_context         + purpose EOC_BINDING_APPROVAL, bound to one binding request
--   eoc_binding_approvals_v13         + approval_method (WAREHOUSE_SESSION | CENTRAL_PASSKEY); auth_session_id is
--                                     required exactly for WAREHOUSE_SESSION (unchanged for the vendor writer)
--   eoc_create_binding_v13            (624, replaced; vendor text + one condition) also accepts central evidence made for
--                                     THIS request; every other 624 check is unchanged (two distinct approvers, neither
--                                     the target, global approver role, fresh UV evidence, consumed once)
--   functions (owner tcds_identity_function_owner, SECURITY DEFINER, search_path pg_catalog):
--     admin    central_request_binding_v1, central_cancel_binding_request_v1           -> tcds_identity_central_admin
--     verifier central_approval_begin_v1, central_binding_request_info_v1,
--              central_finalize_approval_v1                                           -> tcds_identity_central_verifier
-- The second valid approval writes the 623 binding in the same transaction (624's writer). Warehouse tables, functions
-- and rows are not touched.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
 IF to_regclass('warehouse_identity.central_passkeys') IS NULL THEN RAISE EXCEPTION 'R628_626_NOT_INSTALLED'; END IF;
 IF to_regclass('warehouse_identity.eoc_binding_approvals_v13') IS NULL THEN RAISE EXCEPTION 'R628_624_NOT_INSTALLED'; END IF;
 IF to_regclass('warehouse_identity.central_binding_requests') IS NOT NULL THEN RAISE EXCEPTION 'R628_ALREADY_INSTALLED'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'warehouse_identity.eoc_create_binding_v13(uuid,uuid,text,text,uuid,uuid,uuid)'::regprocedure)
    <> '131c35ea8937bbbe39c075d835704d0a' THEN RAISE EXCEPTION 'R628_624_WRITER_NOT_THE_VENDOR_VERSION'; END IF;
 IF NOT EXISTS (SELECT 1 FROM warehouse_identity.roles WHERE role_code = 'EOC_IDENTITY_BINDING_APPROVER') THEN RAISE EXCEPTION 'R628_APPROVER_ROLE_MISSING'; END IF;
END $pre$;

CREATE TEMP TABLE r628_m ON COMMIT DROP AS
SELECT NOT pg_has_role(current_user, 'tcds_identity_function_owner', 'USAGE') OR NOT pg_has_role(current_user, 'tcds_identity_function_owner', 'SET') AS need,
       (SELECT inherit_option FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS m_inherit,
       (SELECT set_option FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS m_set,
       EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS had,
       has_schema_privilege('tcds_identity_function_owner', 'warehouse_identity', 'CREATE') AS had_create;
DO $up$ BEGIN
 IF (SELECT need FROM r628_m) THEN EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT TRUE, SET TRUE', current_user); END IF;
 IF NOT (SELECT had_create FROM r628_m) THEN EXECUTE 'GRANT CREATE ON SCHEMA warehouse_identity TO tcds_identity_function_owner'; END IF;
END $up$;

-- (a) binding requests ------------------------------------------------------------------------------------------------
CREATE TABLE warehouse_identity.central_binding_requests (
  central_binding_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  issuer text NOT NULL CHECK (issuer ~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$'),
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 3 AND 200),
  requested_by uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'BOUND', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  bound_at timestamptz,
  cancelled_at timestamptz,
  CHECK (requested_by <> target_user_id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days'),
  CHECK ((status = 'BOUND') = (bound_at IS NOT NULL)),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX central_binding_requests_one_open ON warehouse_identity.central_binding_requests (issuer, target_user_id) WHERE status = 'OPEN';
ALTER TABLE warehouse_identity.central_binding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.central_binding_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.central_binding_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON warehouse_identity.central_binding_requests TO tcds_identity_function_owner;

-- (b) approval ceremony context ----------------------------------------------------------------------------------------
ALTER TABLE warehouse_identity.central_challenge_context DROP CONSTRAINT central_challenge_context_purpose_check;
ALTER TABLE warehouse_identity.central_challenge_context ADD CONSTRAINT central_challenge_context_purpose_check
  CHECK (purpose IN ('CENTRAL_PASSKEY_ENROLLMENT', 'EOC_OIDC_LOGIN', 'EOC_BINDING_APPROVAL'));
ALTER TABLE warehouse_identity.central_challenge_context ADD COLUMN binding_request_id uuid
  REFERENCES warehouse_identity.central_binding_requests(central_binding_request_id);
ALTER TABLE warehouse_identity.central_challenge_context ADD CONSTRAINT central_challenge_context_approval_check
  CHECK ((purpose = 'EOC_BINDING_APPROVAL') = (binding_request_id IS NOT NULL));

-- (c) 624 approvals: method column; the session is required exactly for the vendor (Warehouse) method --------------------
ALTER TABLE warehouse_identity.eoc_binding_approvals_v13 ADD COLUMN approval_method text NOT NULL DEFAULT 'WAREHOUSE_SESSION'
  CHECK (approval_method IN ('WAREHOUSE_SESSION', 'CENTRAL_PASSKEY'));
ALTER TABLE warehouse_identity.eoc_binding_approvals_v13 ALTER COLUMN auth_session_id DROP NOT NULL;
ALTER TABLE warehouse_identity.eoc_binding_approvals_v13 ADD CONSTRAINT eoc_binding_approvals_v13_method_session_check
  CHECK ((approval_method = 'WAREHOUSE_SESSION') = (auth_session_id IS NOT NULL));
GRANT INSERT ON warehouse_identity.eoc_binding_approvals_v13 TO tcds_identity_function_owner;
CREATE POLICY eoc628_approvals_owner_insert ON warehouse_identity.eoc_binding_approvals_v13 FOR INSERT TO tcds_identity_function_owner WITH CHECK (true);

-- (d) 624 writer, replaced: vendor text + the central-evidence condition (see the 628 comment inside) -----------------
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
   LEFT JOIN warehouse_identity.auth_sessions sess ON sess.auth_session_id=a.auth_session_id AND sess.user_id=u.user_id
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
    AND a.approver_user_id IN(p_first,p_second) AND a.consumed_at IS NULL AND a.expires_at>v_now
    -- 628: either the approver's fresh AAL2 Warehouse session (as delivered), or central laptop passkey evidence made
    -- for THIS binding request (purpose, request, binding and subject recorded in the evidence by the ceremony).
    AND (sess.auth_session_id IS NOT NULL
      OR (a.auth_session_id IS NULL AND a.approval_method='CENTRAL_PASSKEY'
          AND ev.details->>'purpose'='EOC_BINDING_APPROVAL' AND ev.details->>'bindingRequestId'=p_request::text
          AND ev.details->>'bindingId'=p_binding::text AND ev.details->>'subjectHash'=p_subject_hash)))<>2
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

-- (e) helpers -----------------------------------------------------------------------------------------------------------
CREATE FUNCTION warehouse_identity.central_is_binding_approver_v1(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT warehouse_identity.central_user_active_v1(p_user_id) AND EXISTS (
    SELECT 1 FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.roles rol ON rol.role_id = ra.role_id AND rol.active
     WHERE ra.user_id = p_user_id AND ra.revoked_at IS NULL AND ra.valid_from <= clock_timestamp()
       AND (ra.valid_until IS NULL OR ra.valid_until > clock_timestamp()) AND ra.facility_id IS NULL AND ra.station_id IS NULL
       AND 'enterprise:identity:eoc_binding:approve' = ANY (rol.permissions))
$fn$;

-- (f) admin: binding requests -------------------------------------------------------------------------------------------
-- The subject hash is sha256(hex) of the opaque OIDC subject, computed by login-v2-api (it holds the subject key).
CREATE FUNCTION warehouse_identity.central_request_binding_v1(p_target_user_id uuid, p_issuer text, p_subject_hash text,
  p_purpose text, p_requested_by uuid, p_ttl_hours integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE v uuid; v_now timestamptz := clock_timestamp();
BEGIN
 IF p_target_user_id IS NULL OR p_requested_by IS NULL OR p_target_user_id = p_requested_by
  OR p_issuer !~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$' OR p_subject_hash !~ '^[0-9a-f]{64}$'
  OR length(btrim(coalesce(p_purpose, ''))) NOT BETWEEN 3 AND 200 OR p_ttl_hours IS NULL OR p_ttl_hours NOT BETWEEN 1 AND 168
 THEN RAISE EXCEPTION 'CENTRAL_BINDING_REQUEST_INVALID' USING ERRCODE = '22023'; END IF;
 IF NOT warehouse_identity.central_user_active_v1(p_target_user_id) OR NOT warehouse_identity.central_user_active_v1(p_requested_by)
 THEN RAISE EXCEPTION 'CENTRAL_BINDING_USER_NOT_ACTIVE' USING ERRCODE = '42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM warehouse_identity.central_passkeys p WHERE p.user_id = p_target_user_id AND p.security_state = 'ACTIVE')
 THEN RAISE EXCEPTION 'CENTRAL_BINDING_TARGET_HAS_NO_PASSKEY' USING ERRCODE = '42501'; END IF;
 IF EXISTS (SELECT 1 FROM warehouse_identity.eoc_federated_subject_bindings_v12 b WHERE b.issuer = p_issuer
             AND (b.user_id = p_target_user_id OR b.subject_hash = p_subject_hash))
 THEN RAISE EXCEPTION 'CENTRAL_BINDING_ALREADY_EXISTS' USING ERRCODE = '23505'; END IF;
 UPDATE warehouse_identity.central_binding_requests SET status = 'CANCELLED', cancelled_at = v_now
  WHERE issuer = p_issuer AND target_user_id = p_target_user_id AND status = 'OPEN';
 INSERT INTO warehouse_identity.central_binding_requests (target_user_id, issuer, subject_hash, purpose, requested_by, expires_at)
 VALUES (p_target_user_id, p_issuer, p_subject_hash, btrim(p_purpose), p_requested_by, v_now + make_interval(hours => p_ttl_hours))
 RETURNING central_binding_request_id INTO v;
 RETURN v;
END $fn$;

CREATE FUNCTION warehouse_identity.central_cancel_binding_request_v1(p_request_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
 UPDATE warehouse_identity.central_binding_requests SET status = 'CANCELLED', cancelled_at = clock_timestamp()
  WHERE central_binding_request_id = p_request_id AND status = 'OPEN';
 RETURN FOUND;
END $fn$;

-- (g) verifier: what the approval page shows (no hash, no internal ids beyond the request) --------------------------------
CREATE FUNCTION warehouse_identity.central_binding_request_info_v1(p_request_id uuid)
RETURNS TABLE (request_id uuid, status text, purpose text, target_display_name text, target_username text, issuer text,
  expires_at timestamptz, approvals integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT r.central_binding_request_id, CASE WHEN r.status = 'OPEN' AND r.expires_at <= clock_timestamp() THEN 'EXPIRED' ELSE r.status END,
         r.purpose, u.display_name::text, u.username::text, r.issuer, r.expires_at,
         (SELECT count(DISTINCT a.approver_user_id)::int FROM warehouse_identity.eoc_binding_approvals_v13 a
           WHERE a.request_id = r.central_binding_request_id AND a.binding_id = r.binding_id AND a.approval_method = 'CENTRAL_PASSKEY')
    FROM warehouse_identity.central_binding_requests r JOIN warehouse_identity.users u ON u.user_id = r.target_user_id
   WHERE r.central_binding_request_id = p_request_id
$fn$;

-- (h) verifier: approval ceremony ---------------------------------------------------------------------------------------
-- Discoverable: no user is named; the passkey that signs identifies the approver, checked at finalize.
CREATE FUNCTION warehouse_identity.central_approval_begin_v1(p_request_id uuid, p_rp_id text, p_origin text, p_challenge_hash bytea,
  p_request uuid, p_correlation uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE r warehouse_identity.central_binding_requests%ROWTYPE; v_ch uuid; v_now timestamptz := clock_timestamp();
BEGIN
 IF p_challenge_hash IS NULL OR octet_length(p_challenge_hash) <> 32 OR p_origin <> 'https://' || p_rp_id OR p_request IS NULL OR p_correlation IS NULL
 THEN RAISE EXCEPTION 'CENTRAL_APPROVAL_REQUEST_INVALID' USING ERRCODE = '22023'; END IF;
 SELECT * INTO r FROM warehouse_identity.central_binding_requests x WHERE x.central_binding_request_id = p_request_id;
 IF r.central_binding_request_id IS NULL OR r.status <> 'OPEN' OR r.expires_at <= v_now
 THEN RAISE EXCEPTION 'CENTRAL_BINDING_REQUEST_NOT_OPEN' USING ERRCODE = '42501'; END IF;
 INSERT INTO warehouse_identity.auth_challenges (user_id, device_id, ceremony_type, challenge_hash, expected_origin, expected_rp_id,
   request_id, correlation_id, expires_at, result)
 VALUES (NULL, NULL, 'PASSKEY_AUTHENTICATION', p_challenge_hash, p_origin, p_rp_id, p_request, p_correlation, v_now + interval '120 seconds', 'PROCESSING')
 RETURNING auth_challenge_id INTO v_ch;
 INSERT INTO warehouse_identity.central_challenge_context (auth_challenge_id, purpose, rp_id, binding_request_id)
 VALUES (v_ch, 'EOC_BINDING_APPROVAL', p_rp_id, p_request_id);
 RETURN v_ch;
END $fn$;

CREATE FUNCTION warehouse_identity.central_finalize_approval_v1(p_challenge_id uuid, p_claim_hash bytea, p_generation bigint,
  p_central_passkey_id uuid, p_expected_row_version bigint, p_prior_sign_count bigint, p_observed_sign_count bigint,
  p_verified_origin text, p_verified_rp_id text, p_user_verified boolean,
  p_authenticator_data_sha256 text, p_client_data_json_sha256 text, p_signature_sha256 text, p_backup_eligible boolean, p_backed_up boolean,
  p_verifier_service text, p_verifier_version text, p_verifier_instance_id text, p_request_id uuid, p_correlation_id uuid)
RETURNS TABLE (outcome text, approver_user_id uuid, evidence_id uuid, approvals integer, binding_id uuid, bound boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
#variable_conflict use_column
DECLARE a warehouse_identity.auth_challenges%ROWTYPE; c warehouse_identity.central_challenge_context%ROWTYPE;
  p warehouse_identity.central_passkeys%ROWTYPE; r warehouse_identity.central_binding_requests%ROWTYPE;
  v_ev uuid; v_now timestamptz := clock_timestamp(); v_code text; v_n integer; v_pair uuid[];
BEGIN
 a := warehouse_identity.central_held_claim_v1(p_challenge_id, p_claim_hash, p_generation, 'EOC_BINDING_APPROVAL');
 IF a.auth_challenge_id IS NULL THEN RETURN QUERY SELECT 'CLAIM_NOT_HELD', NULL::uuid, NULL::uuid, 0, NULL::uuid, false; RETURN; END IF;
 SELECT * INTO c FROM warehouse_identity.central_challenge_context x WHERE x.auth_challenge_id = a.auth_challenge_id;
 SELECT * INTO r FROM warehouse_identity.central_binding_requests x WHERE x.central_binding_request_id = c.binding_request_id FOR UPDATE;
 SELECT * INTO p FROM warehouse_identity.central_passkeys x WHERE x.central_passkey_id = p_central_passkey_id AND x.rp_id = a.expected_rp_id FOR UPDATE;
 v_code := CASE
   WHEN a.expected_origin <> p_verified_origin OR a.expected_rp_id <> p_verified_rp_id THEN 'ORIGIN_OR_RP_MISMATCH'
   WHEN p_user_verified IS NOT TRUE THEN 'USER_VERIFICATION_REQUIRED'
   WHEN r.status <> 'OPEN' OR r.expires_at <= v_now THEN 'CENTRAL_BINDING_REQUEST_NOT_OPEN'
   WHEN p.central_passkey_id IS NULL OR p.security_state <> 'ACTIVE' THEN 'CREDENTIAL_OR_USER_NOT_ACTIVE'
   WHEN p.row_version <> p_expected_row_version OR p.sign_count <> p_prior_sign_count THEN 'PASSKEY_STATE_CHANGED'
   WHEN p.user_id = r.target_user_id THEN 'APPROVER_IS_THE_TARGET'
   WHEN p.user_id = r.requested_by THEN 'APPROVER_IS_THE_REQUESTER'
   WHEN NOT warehouse_identity.central_is_binding_approver_v1(p.user_id) THEN 'APPROVER_NOT_AUTHORIZED'
   WHEN EXISTS (SELECT 1 FROM warehouse_identity.eoc_binding_approvals_v13 x WHERE x.request_id = r.central_binding_request_id
                  AND x.binding_id = r.binding_id AND x.approver_user_id = p.user_id) THEN 'APPROVER_ALREADY_APPROVED'
 END;
 IF v_code IS NULL AND (p_observed_sign_count IS NULL OR p_observed_sign_count < 0
     OR ((p_observed_sign_count > 0 OR p.sign_count > 0) AND p_observed_sign_count <= p.sign_count)) THEN
   UPDATE warehouse_identity.central_passkeys SET security_state = 'SUSPENDED', suspended_at = v_now, suspension_reason = 'COUNTER_REGRESSION',
          row_version = row_version + 1 WHERE central_passkey_id = p.central_passkey_id;
   v_code := 'COUNTER_REGRESSION';
 END IF;
 IF v_code IS NOT NULL THEN
   PERFORM warehouse_identity.central_fail_challenge_v1(a.auth_challenge_id, p_claim_hash, v_code);
   RETURN QUERY SELECT v_code, NULL::uuid, NULL::uuid, 0, NULL::uuid, false; RETURN;
 END IF;
 UPDATE warehouse_identity.central_passkeys SET sign_count = p_observed_sign_count, last_used_at = v_now, row_version = row_version + 1
  WHERE central_passkey_id = p.central_passkey_id;
 INSERT INTO warehouse_identity.webauthn_verification_evidence (auth_challenge_id, ceremony_type, user_id, passkey_id, credential_id,
   verified_origin, verified_rp_id, user_verified, authenticator_data_sha256, client_data_json_sha256, signature_sha256,
   observed_sign_count, prior_sign_count, counter_anomaly, backup_eligible, backed_up, verifier_service, verifier_version,
   verifier_instance_id, verified_at, request_id, correlation_id, details)
 VALUES (a.auth_challenge_id, 'PASSKEY_AUTHENTICATION', p.user_id, NULL, p.credential_id, p_verified_origin, p_verified_rp_id, true,
   p_authenticator_data_sha256, p_client_data_json_sha256, p_signature_sha256, p_observed_sign_count, p.sign_count, false,
   p_backup_eligible, p_backed_up, p_verifier_service, p_verifier_version, p_verifier_instance_id, v_now, p_request_id, p_correlation_id,
   jsonb_build_object('purpose', 'EOC_BINDING_APPROVAL', 'centralPasskeyId', p.central_passkey_id,
     'bindingRequestId', r.central_binding_request_id, 'bindingId', r.binding_id, 'targetUserId', r.target_user_id,
     'issuer', r.issuer, 'subjectHash', r.subject_hash))
 RETURNING webauthn_verification_evidence_id INTO v_ev;
 UPDATE warehouse_identity.auth_challenges SET user_id = p.user_id, consumed_at = v_now, result = 'SUCCEEDED', verified_origin = p_verified_origin,
        verified_rp_id = p_verified_rp_id, user_verification_performed = true, verification_evidence_id = v_ev, credential_id = p.credential_id
  WHERE auth_challenge_id = a.auth_challenge_id;
 INSERT INTO warehouse_identity.eoc_binding_approvals_v13 (evidence_id, request_id, binding_id, approver_user_id, auth_session_id,
   web_authn_evidence_id, target_user_id, oidc_issuer, subject_hash, verified_at, expires_at, verifier_digest, ceremony_id, approval_method)
 VALUES (gen_random_uuid(), r.central_binding_request_id, r.binding_id, p.user_id, NULL, v_ev, r.target_user_id, r.issuer, r.subject_hash,
   v_now, v_now + interval '5 minutes',
   encode(sha256(convert_to(concat_ws('|', v_ev, a.auth_challenge_id, p.credential_id, p_authenticator_data_sha256, p_client_data_json_sha256,
     p_signature_sha256, r.central_binding_request_id, r.subject_hash), 'UTF8')), 'hex'),
   a.auth_challenge_id, 'CENTRAL_PASSKEY');
 -- Two distinct, unconsumed, unexpired approvals for this request -> 624's writer creates the 623 binding now.
 SELECT array_agg(x.approver_user_id ORDER BY x.verified_at), count(DISTINCT x.approver_user_id)::int INTO v_pair, v_n
   FROM warehouse_identity.eoc_binding_approvals_v13 x
  WHERE x.request_id = r.central_binding_request_id AND x.binding_id = r.binding_id AND x.consumed_at IS NULL AND x.expires_at > v_now
    AND x.approval_method = 'CENTRAL_PASSKEY';
 IF v_n >= 2 THEN
   PERFORM warehouse_identity.eoc_create_binding_v13(r.binding_id, r.target_user_id, r.issuer, r.subject_hash, r.central_binding_request_id,
     v_pair[1], v_pair[2]);
   UPDATE warehouse_identity.central_binding_requests SET status = 'BOUND', bound_at = v_now WHERE central_binding_request_id = r.central_binding_request_id;
   RETURN QUERY SELECT 'SUCCEEDED', p.user_id, v_ev, 2, r.binding_id, true; RETURN;
 END IF;
 RETURN QUERY SELECT 'SUCCEEDED', p.user_id, v_ev, v_n, r.binding_id, false;
END $fn$;

-- (i) ownership, privileges -----------------------------------------------------------------------------------------------
DO $own$
DECLARE f text;
BEGIN
 FOREACH f IN ARRAY ARRAY[
   'warehouse_identity.central_is_binding_approver_v1(uuid)',
   'warehouse_identity.central_request_binding_v1(uuid,text,text,text,uuid,integer)',
   'warehouse_identity.central_cancel_binding_request_v1(uuid)',
   'warehouse_identity.central_binding_request_info_v1(uuid)',
   'warehouse_identity.central_approval_begin_v1(uuid,text,text,bytea,uuid,uuid)',
   'warehouse_identity.central_finalize_approval_v1(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  EXECUTE format('ALTER FUNCTION %s OWNER TO tcds_identity_function_owner', f);
 END LOOP;
 EXECUTE 'ALTER FUNCTION warehouse_identity.eoc_create_binding_v13(uuid,uuid,text,text,uuid,uuid,uuid) OWNER TO tcds_identity_function_owner';
END $own$;
GRANT EXECUTE ON FUNCTION warehouse_identity.central_request_binding_v1(uuid,text,text,text,uuid,integer),
  warehouse_identity.central_cancel_binding_request_v1(uuid) TO tcds_identity_central_admin;
GRANT EXECUTE ON FUNCTION warehouse_identity.central_binding_request_info_v1(uuid),
  warehouse_identity.central_approval_begin_v1(uuid,text,text,bytea,uuid,uuid),
  warehouse_identity.central_finalize_approval_v1(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid)
  TO tcds_identity_central_verifier;

DO $down$ BEGIN
 IF NOT (SELECT had_create FROM r628_m) THEN EXECUTE 'REVOKE CREATE ON SCHEMA warehouse_identity FROM tcds_identity_function_owner'; END IF;
 IF (SELECT need FROM r628_m) THEN
  IF (SELECT had FROM r628_m) THEN
   EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT %s, SET %s', current_user,
                  (SELECT m_inherit FROM r628_m)::text, (SELECT m_set FROM r628_m)::text);
  ELSE EXECUTE format('REVOKE tcds_identity_function_owner FROM %I', current_user); END IF;
 END IF;
END $down$;

DO $verify$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid::regprocedure AS f, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig FROM pg_proc p
           WHERE p.pronamespace = 'warehouse_identity'::regnamespace
             AND p.proname IN ('central_is_binding_approver_v1','central_request_binding_v1','central_cancel_binding_request_v1',
                               'central_binding_request_info_v1','central_approval_begin_v1','central_finalize_approval_v1') LOOP
  IF r.owner <> 'tcds_identity_function_owner' OR NOT r.prosecdef OR r.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
   THEN RAISE EXCEPTION 'R628_FUNCTION_SETUP_WRONG %', r.f; END IF;
  IF has_function_privilege('public', r.f, 'EXECUTE') OR has_function_privilege('anon', r.f, 'EXECUTE')
     OR has_function_privilege('authenticated', r.f, 'EXECUTE') OR has_function_privilege('service_role', r.f, 'EXECUTE')
   THEN RAISE EXCEPTION 'R628_EXECUTE_TOO_BROAD %', r.f; END IF;
 END LOOP;
 IF NOT has_function_privilege('tcds_eoc_binding_admin', 'warehouse_identity.eoc_create_binding_v13(uuid,uuid,text,text,uuid,uuid,uuid)', 'EXECUTE')
  OR has_function_privilege('tcds_identity_central_verifier', 'warehouse_identity.eoc_create_binding_v13(uuid,uuid,text,text,uuid,uuid,uuid)', 'EXECUTE')
  THEN RAISE EXCEPTION 'R628_624_WRITER_GRANTS_CHANGED'; END IF;
END $verify$;
COMMIT;
