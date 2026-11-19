-- 630 - ours (TCDS production engineering). STAGING FIRST. EOC module-grant approval with the central laptop passkey.
-- The EOC (retail DB, vendor 072) creates a module grant only from TWO signed IAM verifier attestations of two
-- different approvers, each bound to that exact module/operation/scope and at most 5 minutes old. This migration is
-- the IAM side: who may approve, what exactly is approved, and the passkey ceremony that records each approval.
-- Decided 2026-11-19: one approval per GRANT SET. An approver reviews the whole set (e.g. VIEW on 20 modules,
-- enterprise-wide, 90 days) and signs once; the ceremony is bound to the set's fingerprint (set_sha256), and the
-- verifier then issues one vendor attestation per item. The vendor 072 writer is not changed.
-- Requires 626 and 628. Changes (no Warehouse table, function or row is touched):
--   roles                        + EOC_MODULE_GRANT_APPROVER (permission enterprise:eoc:module_grant:approve), assigned to nobody
--   central_grant_requests       one request: person, normalized item set, validity, fingerprint, status
--   central_grant_approvals      one row per approval ceremony; live for 5 minutes (the vendor window); single use
--   central_challenge_context    + purpose EOC_GRANT_APPROVAL, bound to one grant request
--   functions (owner tcds_identity_function_owner, SECURITY DEFINER, search_path pg_catalog):
--     admin    central_request_grants_v1, central_cancel_grant_request_v1                    -> tcds_identity_central_admin
--     verifier central_grant_request_info_v1, central_grant_approval_begin_v1,
--              central_finalize_grant_approval_v1, central_record_grants_v1                  -> tcds_identity_central_verifier
--     internal central_is_grant_approver_v1, central_normalize_grant_items_v1 (no EXECUTE for anyone)
-- Only LIVE approvals count (unconsumed, under 5 minutes old). An approver whose approval expired may approve again.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
 IF to_regclass('warehouse_identity.central_binding_requests') IS NULL THEN RAISE EXCEPTION 'R630_628_NOT_INSTALLED'; END IF;
 IF to_regclass('warehouse_identity.central_grant_requests') IS NOT NULL THEN RAISE EXCEPTION 'R630_ALREADY_INSTALLED'; END IF;
 IF EXISTS (SELECT 1 FROM warehouse_identity.roles WHERE role_code = 'EOC_MODULE_GRANT_APPROVER') THEN RAISE EXCEPTION 'R630_ROLE_EXISTS_RECONCILE'; END IF;
END $pre$;

CREATE TEMP TABLE r630_m ON COMMIT DROP AS
SELECT NOT pg_has_role(current_user, 'tcds_identity_function_owner', 'USAGE') OR NOT pg_has_role(current_user, 'tcds_identity_function_owner', 'SET') AS need,
       (SELECT inherit_option FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS m_inherit,
       (SELECT set_option FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS m_set,
       EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS had,
       has_schema_privilege('tcds_identity_function_owner', 'warehouse_identity', 'CREATE') AS had_create;
DO $up$ BEGIN
 IF (SELECT need FROM r630_m) THEN EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT TRUE, SET TRUE', current_user); END IF;
 IF NOT (SELECT had_create FROM r630_m) THEN EXECUTE 'GRANT CREATE ON SCHEMA warehouse_identity TO tcds_identity_function_owner'; END IF;
END $up$;

-- (a) the approver capability (assigned to nobody here) ------------------------------------------------------------------
INSERT INTO warehouse_identity.roles (role_code, role_name, permissions, active)
VALUES ('EOC_MODULE_GRANT_APPROVER', 'EOC Module Grant Approver', ARRAY['enterprise:eoc:module_grant:approve']::text[], true);

-- (b) grant requests ------------------------------------------------------------------------------------------------------
CREATE TABLE warehouse_identity.central_grant_requests (
  central_grant_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 40),
  valid_days integer NOT NULL CHECK (valid_days BETWEEN 1 AND 366),
  set_sha256 text NOT NULL CHECK (set_sha256 ~ '^[0-9a-f]{64}$'),
  purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 3 AND 200),
  requested_by uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'GRANTED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  granted_at timestamptz,
  cancelled_at timestamptz,
  eoc_grant_ids uuid[],
  CHECK (requested_by <> target_user_id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days'),
  CHECK ((status = 'GRANTED') = (granted_at IS NOT NULL)),
  CHECK ((status = 'GRANTED') = (eoc_grant_ids IS NOT NULL)),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CHECK (eoc_grant_ids IS NULL OR cardinality(eoc_grant_ids) = jsonb_array_length(items))
);
CREATE UNIQUE INDEX central_grant_requests_one_open ON warehouse_identity.central_grant_requests (target_user_id) WHERE status = 'OPEN';

CREATE TABLE warehouse_identity.central_grant_approvals (
  central_grant_approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_request_id uuid NOT NULL REFERENCES warehouse_identity.central_grant_requests(central_grant_request_id) ON DELETE RESTRICT,
  approver_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  web_authn_evidence_id uuid NOT NULL UNIQUE
    REFERENCES warehouse_identity.webauthn_verification_evidence(webauthn_verification_evidence_id) ON DELETE RESTRICT,
  auth_challenge_id uuid NOT NULL UNIQUE,
  set_sha256 text NOT NULL CHECK (set_sha256 ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > verified_at AND expires_at <= verified_at + interval '5 minutes')
);
CREATE INDEX central_grant_approvals_request ON warehouse_identity.central_grant_approvals (grant_request_id);

DO $rls$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['central_grant_requests', 'central_grant_approvals'] LOOP
  EXECUTE format('ALTER TABLE warehouse_identity.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE warehouse_identity.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL ON warehouse_identity.%I FROM PUBLIC, anon, authenticated, service_role', t);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON warehouse_identity.%I TO tcds_identity_function_owner', t);
  EXECUTE format('CREATE POLICY r630_fn_owner ON warehouse_identity.%I FOR ALL TO tcds_identity_function_owner USING (true) WITH CHECK (true)', t);
 END LOOP;
END $rls$;

-- (c) approval ceremony context --------------------------------------------------------------------------------------------
ALTER TABLE warehouse_identity.central_challenge_context DROP CONSTRAINT central_challenge_context_purpose_check;
ALTER TABLE warehouse_identity.central_challenge_context ADD CONSTRAINT central_challenge_context_purpose_check
  CHECK (purpose IN ('CENTRAL_PASSKEY_ENROLLMENT', 'EOC_OIDC_LOGIN', 'EOC_BINDING_APPROVAL', 'EOC_GRANT_APPROVAL'));
ALTER TABLE warehouse_identity.central_challenge_context ADD COLUMN grant_request_id uuid
  REFERENCES warehouse_identity.central_grant_requests(central_grant_request_id);
ALTER TABLE warehouse_identity.central_challenge_context ADD CONSTRAINT central_challenge_context_grant_check
  CHECK ((purpose = 'EOC_GRANT_APPROVAL') = (grant_request_id IS NOT NULL));

-- (d) helpers ----------------------------------------------------------------------------------------------------------------
CREATE FUNCTION warehouse_identity.central_is_grant_approver_v1(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT warehouse_identity.central_user_active_v1(p_user_id) AND EXISTS (
    SELECT 1 FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.roles rol ON rol.role_id = ra.role_id AND rol.active
     WHERE ra.user_id = p_user_id AND ra.revoked_at IS NULL AND ra.valid_from <= clock_timestamp()
       AND (ra.valid_until IS NULL OR ra.valid_until > clock_timestamp()) AND ra.facility_id IS NULL AND ra.station_id IS NULL
       AND 'enterprise:eoc:module_grant:approve' = ANY (rol.permissions))
$fn$;

-- The EOC's own vocabulary (vendor 064 CHECKs + policy.mjs): anything else is refused here, before anyone approves it.
-- Output: the items sorted, scope ids sorted and de-duplicated; one canonical form per set.
CREATE FUNCTION warehouse_identity.central_normalize_grant_items_v1(p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE e jsonb; v_out jsonb;
  mods text[] := ARRAY['executive','capital','acquisition','market','retail','pqp','purchasing','warehouse','shipping','returns','identity',
                       'hardware','governance','forensic','ai','administration','decisions','agents','knowledge','scenarios'];
  ops text[] := ARRAY['VIEW','INVESTIGATE','MANAGE','APPROVE','ADMINISTER','EXPORT','EXECUTE','CONFIGURE'];
  scopes text[] := ARRAY['ENTERPRISE','BUSINESS_UNIT','DEPARTMENT','FACILITY','TEAM','RESOURCE'];
BEGIN
 IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 40
 THEN RAISE EXCEPTION 'CENTRAL_GRANT_ITEMS_INVALID' USING ERRCODE = '22023'; END IF;
 FOR e IN SELECT x FROM jsonb_array_elements(p_items) x LOOP
  IF jsonb_typeof(e) <> 'object'
   OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) IS DISTINCT FROM ARRAY['moduleId','operation','scopeIds','scopeKind']
   OR jsonb_typeof(e->'moduleId') <> 'string' OR NOT (e->>'moduleId') = ANY (mods)
   OR jsonb_typeof(e->'operation') <> 'string' OR NOT (e->>'operation') = ANY (ops)
   OR jsonb_typeof(e->'scopeKind') <> 'string' OR NOT (e->>'scopeKind') = ANY (scopes)
   OR jsonb_typeof(e->'scopeIds') <> 'array' OR jsonb_array_length(e->'scopeIds') > 50
   OR EXISTS (SELECT 1 FROM jsonb_array_elements(e->'scopeIds') s WHERE jsonb_typeof(s) <> 'string' OR length(s #>> '{}') NOT BETWEEN 1 AND 200)
   OR ((e->>'scopeKind') = 'ENTERPRISE') <> (jsonb_array_length(e->'scopeIds') = 0)
  THEN RAISE EXCEPTION 'CENTRAL_GRANT_ITEMS_INVALID' USING ERRCODE = '22023'; END IF;
 END LOOP;
 SELECT jsonb_agg(n ORDER BY n->>'moduleId', n->>'operation', n->>'scopeKind', (n->'scopeIds')::text) INTO v_out
   FROM (SELECT DISTINCT jsonb_build_object('moduleId', x->>'moduleId', 'operation', x->>'operation', 'scopeKind', x->>'scopeKind',
                 'scopeIds', coalesce((SELECT jsonb_agg(DISTINCT s #>> '{}' ORDER BY s #>> '{}') FROM jsonb_array_elements(x->'scopeIds') s), '[]'::jsonb)) n
           FROM jsonb_array_elements(p_items) x) d;
 IF jsonb_array_length(v_out) <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'CENTRAL_GRANT_ITEMS_DUPLICATED' USING ERRCODE = '22023'; END IF;
 RETURN v_out;
END $fn$;

-- (e) admin: grant requests ------------------------------------------------------------------------------------------------
-- Only a person with a VERIFIED, unrevoked EOC binding can be granted anything: a grant is useless (and confusing) for
-- someone the EOC cannot sign in. A new request for the same person replaces the open one.
CREATE FUNCTION warehouse_identity.central_request_grants_v1(p_target_user_id uuid, p_items jsonb, p_valid_days integer,
  p_purpose text, p_requested_by uuid, p_ttl_hours integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE v uuid; v_items jsonb; v_now timestamptz := clock_timestamp();
BEGIN
 IF p_target_user_id IS NULL OR p_requested_by IS NULL OR p_target_user_id = p_requested_by
  OR p_valid_days IS NULL OR p_valid_days NOT BETWEEN 1 AND 366
  OR length(btrim(coalesce(p_purpose, ''))) NOT BETWEEN 3 AND 200 OR p_ttl_hours IS NULL OR p_ttl_hours NOT BETWEEN 1 AND 168
 THEN RAISE EXCEPTION 'CENTRAL_GRANT_REQUEST_INVALID' USING ERRCODE = '22023'; END IF;
 v_items := warehouse_identity.central_normalize_grant_items_v1(p_items);
 IF NOT warehouse_identity.central_user_active_v1(p_target_user_id) OR NOT warehouse_identity.central_user_active_v1(p_requested_by)
 THEN RAISE EXCEPTION 'CENTRAL_GRANT_USER_NOT_ACTIVE' USING ERRCODE = '42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM warehouse_identity.eoc_federated_subject_bindings_v12 b
                 WHERE b.user_id = p_target_user_id AND b.binding_status = 'VERIFIED' AND b.revoked_at IS NULL)
 THEN RAISE EXCEPTION 'CENTRAL_GRANT_TARGET_NOT_BOUND' USING ERRCODE = '42501'; END IF;
 UPDATE warehouse_identity.central_grant_requests SET status = 'CANCELLED', cancelled_at = v_now
  WHERE target_user_id = p_target_user_id AND status = 'OPEN';
 INSERT INTO warehouse_identity.central_grant_requests (target_user_id, items, valid_days, set_sha256, purpose, requested_by, expires_at)
 VALUES (p_target_user_id, v_items, p_valid_days,
         encode(sha256(convert_to(jsonb_build_object('targetUserId', p_target_user_id, 'items', v_items, 'validDays', p_valid_days)::text, 'UTF8')), 'hex'),
         btrim(p_purpose), p_requested_by, v_now + make_interval(hours => p_ttl_hours))
 RETURNING central_grant_request_id INTO v;
 RETURN v;
END $fn$;

CREATE FUNCTION warehouse_identity.central_cancel_grant_request_v1(p_request_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
 UPDATE warehouse_identity.central_grant_requests SET status = 'CANCELLED', cancelled_at = clock_timestamp()
  WHERE central_grant_request_id = p_request_id AND status = 'OPEN';
 RETURN FOUND;
END $fn$;

-- (f) verifier: request info (the page shows person, purpose, items, validity, live approvals and their window) -----------
CREATE FUNCTION warehouse_identity.central_grant_request_info_v1(p_request_id uuid)
RETURNS TABLE (request_id uuid, status text, purpose text, target_user_id uuid, target_display_name text, target_username text,
  items jsonb, valid_days integer, set_sha256 text, expires_at timestamptz, approvals integer, first_approval_expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT r.central_grant_request_id, CASE WHEN r.status = 'OPEN' AND r.expires_at <= clock_timestamp() THEN 'EXPIRED' ELSE r.status END,
         r.purpose, r.target_user_id, u.display_name::text, u.username::text, r.items, r.valid_days, r.set_sha256, r.expires_at,
         CASE WHEN r.status = 'GRANTED' THEN 2 ELSE
           (SELECT count(DISTINCT a.approver_user_id)::int FROM warehouse_identity.central_grant_approvals a
             WHERE a.grant_request_id = r.central_grant_request_id AND a.consumed_at IS NULL AND a.expires_at > clock_timestamp()) END,
         CASE WHEN r.status = 'OPEN' THEN
           (SELECT min(a.expires_at) FROM warehouse_identity.central_grant_approvals a
             WHERE a.grant_request_id = r.central_grant_request_id AND a.consumed_at IS NULL AND a.expires_at > clock_timestamp()) END
    FROM warehouse_identity.central_grant_requests r JOIN warehouse_identity.users u ON u.user_id = r.target_user_id
   WHERE r.central_grant_request_id = p_request_id
$fn$;

-- (g) verifier: approval ceremony (discoverable: the passkey that signs identifies the approver, checked at finalize) -----
CREATE FUNCTION warehouse_identity.central_grant_approval_begin_v1(p_request_id uuid, p_rp_id text, p_origin text, p_challenge_hash bytea,
  p_request uuid, p_correlation uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE r warehouse_identity.central_grant_requests%ROWTYPE; v_ch uuid; v_now timestamptz := clock_timestamp();
BEGIN
 IF p_challenge_hash IS NULL OR octet_length(p_challenge_hash) <> 32 OR p_origin <> 'https://' || p_rp_id OR p_request IS NULL OR p_correlation IS NULL
 THEN RAISE EXCEPTION 'CENTRAL_APPROVAL_REQUEST_INVALID' USING ERRCODE = '22023'; END IF;
 SELECT * INTO r FROM warehouse_identity.central_grant_requests x WHERE x.central_grant_request_id = p_request_id;
 IF r.central_grant_request_id IS NULL OR r.status <> 'OPEN' OR r.expires_at <= v_now
 THEN RAISE EXCEPTION 'CENTRAL_GRANT_REQUEST_NOT_OPEN' USING ERRCODE = '42501'; END IF;
 INSERT INTO warehouse_identity.auth_challenges (user_id, device_id, ceremony_type, challenge_hash, expected_origin, expected_rp_id,
   request_id, correlation_id, expires_at, result)
 VALUES (NULL, NULL, 'PASSKEY_AUTHENTICATION', p_challenge_hash, p_origin, p_rp_id, p_request, p_correlation, v_now + interval '120 seconds', 'PROCESSING')
 RETURNING auth_challenge_id INTO v_ch;
 INSERT INTO warehouse_identity.central_challenge_context (auth_challenge_id, purpose, rp_id, grant_request_id)
 VALUES (v_ch, 'EOC_GRANT_APPROVAL', p_rp_id, p_request_id);
 RETURN v_ch;
END $fn$;

-- complete = two live approvals of two different approvers; approvals_detail then carries both, oldest first, for the
-- verifier to sign the vendor attestations. The request stays OPEN until central_record_grants_v1 records the EOC grants.
CREATE FUNCTION warehouse_identity.central_finalize_grant_approval_v1(p_challenge_id uuid, p_claim_hash bytea, p_generation bigint,
  p_central_passkey_id uuid, p_expected_row_version bigint, p_prior_sign_count bigint, p_observed_sign_count bigint,
  p_verified_origin text, p_verified_rp_id text, p_user_verified boolean,
  p_authenticator_data_sha256 text, p_client_data_json_sha256 text, p_signature_sha256 text, p_backup_eligible boolean, p_backed_up boolean,
  p_verifier_service text, p_verifier_version text, p_verifier_instance_id text, p_request_id uuid, p_correlation_id uuid)
RETURNS TABLE (outcome text, approver_user_id uuid, evidence_id uuid, approvals integer, complete boolean, approvals_detail jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
#variable_conflict use_column
DECLARE a warehouse_identity.auth_challenges%ROWTYPE; c warehouse_identity.central_challenge_context%ROWTYPE;
  p warehouse_identity.central_passkeys%ROWTYPE; r warehouse_identity.central_grant_requests%ROWTYPE;
  v_ev uuid; v_now timestamptz := clock_timestamp(); v_code text; v_n integer; v_live integer; v_detail jsonb;
BEGIN
 a := warehouse_identity.central_held_claim_v1(p_challenge_id, p_claim_hash, p_generation, 'EOC_GRANT_APPROVAL');
 IF a.auth_challenge_id IS NULL THEN RETURN QUERY SELECT 'CLAIM_NOT_HELD', NULL::uuid, NULL::uuid, 0, false, NULL::jsonb; RETURN; END IF;
 SELECT * INTO c FROM warehouse_identity.central_challenge_context x WHERE x.auth_challenge_id = a.auth_challenge_id;
 SELECT * INTO r FROM warehouse_identity.central_grant_requests x WHERE x.central_grant_request_id = c.grant_request_id FOR UPDATE;
 SELECT * INTO p FROM warehouse_identity.central_passkeys x WHERE x.central_passkey_id = p_central_passkey_id AND x.rp_id = a.expected_rp_id FOR UPDATE;
 SELECT count(DISTINCT x.approver_user_id) INTO v_live FROM warehouse_identity.central_grant_approvals x
  WHERE x.grant_request_id = r.central_grant_request_id AND x.consumed_at IS NULL AND x.expires_at > v_now;
 v_code := CASE
   WHEN a.expected_origin <> p_verified_origin OR a.expected_rp_id <> p_verified_rp_id THEN 'ORIGIN_OR_RP_MISMATCH'
   WHEN p_user_verified IS NOT TRUE THEN 'USER_VERIFICATION_REQUIRED'
   WHEN r.status <> 'OPEN' OR r.expires_at <= v_now THEN 'CENTRAL_GRANT_REQUEST_NOT_OPEN'
   WHEN p.central_passkey_id IS NULL OR p.security_state <> 'ACTIVE' THEN 'CREDENTIAL_OR_USER_NOT_ACTIVE'
   WHEN p.row_version <> p_expected_row_version OR p.sign_count <> p_prior_sign_count THEN 'PASSKEY_STATE_CHANGED'
   WHEN p.user_id = r.target_user_id THEN 'APPROVER_IS_THE_TARGET'
   WHEN p.user_id = r.requested_by THEN 'APPROVER_IS_THE_REQUESTER'
   WHEN NOT warehouse_identity.central_is_grant_approver_v1(p.user_id) THEN 'APPROVER_NOT_AUTHORIZED'
   WHEN EXISTS (SELECT 1 FROM warehouse_identity.central_grant_approvals x WHERE x.grant_request_id = r.central_grant_request_id
                  AND x.approver_user_id = p.user_id AND x.consumed_at IS NULL AND x.expires_at > v_now) THEN 'APPROVER_ALREADY_APPROVED'
   WHEN v_live >= 2 THEN 'CENTRAL_GRANT_ALREADY_APPROVED'
 END;
 IF v_code IS NULL AND (p_observed_sign_count IS NULL OR p_observed_sign_count < 0
     OR ((p_observed_sign_count > 0 OR p.sign_count > 0) AND p_observed_sign_count <= p.sign_count)) THEN
   UPDATE warehouse_identity.central_passkeys SET security_state = 'SUSPENDED', suspended_at = v_now, suspension_reason = 'COUNTER_REGRESSION',
          row_version = row_version + 1 WHERE central_passkey_id = p.central_passkey_id;
   v_code := 'COUNTER_REGRESSION';
 END IF;
 IF v_code IS NOT NULL THEN
   PERFORM warehouse_identity.central_fail_challenge_v1(a.auth_challenge_id, p_claim_hash, v_code);
   RETURN QUERY SELECT v_code, NULL::uuid, NULL::uuid, v_live, false, NULL::jsonb; RETURN;
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
   jsonb_build_object('purpose', 'EOC_GRANT_APPROVAL', 'centralPasskeyId', p.central_passkey_id,
     'grantRequestId', r.central_grant_request_id, 'targetUserId', r.target_user_id, 'setSha256', r.set_sha256,
     'items', jsonb_array_length(r.items), 'validDays', r.valid_days))
 RETURNING webauthn_verification_evidence_id INTO v_ev;
 UPDATE warehouse_identity.auth_challenges SET user_id = p.user_id, consumed_at = v_now, result = 'SUCCEEDED', verified_origin = p_verified_origin,
        verified_rp_id = p_verified_rp_id, user_verification_performed = true, verification_evidence_id = v_ev, credential_id = p.credential_id
  WHERE auth_challenge_id = a.auth_challenge_id;
 INSERT INTO warehouse_identity.central_grant_approvals (grant_request_id, approver_user_id, web_authn_evidence_id, auth_challenge_id,
   set_sha256, verified_at, expires_at)
 VALUES (r.central_grant_request_id, p.user_id, v_ev, a.auth_challenge_id, r.set_sha256, v_now, v_now + interval '5 minutes');
 SELECT count(DISTINCT x.approver_user_id)::int,
        jsonb_agg(jsonb_build_object('approvalId', x.central_grant_approval_id, 'approverUserId', x.approver_user_id,
          'webAuthnEvidenceId', x.web_authn_evidence_id, 'challengeId', x.auth_challenge_id,
          'verifiedAt', to_char(x.verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'expiresAt', to_char(x.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY x.verified_at)
   INTO v_n, v_detail
   FROM warehouse_identity.central_grant_approvals x
  WHERE x.grant_request_id = r.central_grant_request_id AND x.consumed_at IS NULL AND x.expires_at > v_now;
 RETURN QUERY SELECT 'SUCCEEDED', p.user_id, v_ev, v_n, v_n >= 2, CASE WHEN v_n >= 2 THEN v_detail END;
END $fn$;

-- (h) verifier: record the EOC grants the two approvals produced (consumes both approvals; request GRANTED) ---------------
CREATE FUNCTION warehouse_identity.central_record_grants_v1(p_request_id uuid, p_approval_ids uuid[], p_eoc_grant_ids uuid[]) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE r warehouse_identity.central_grant_requests%ROWTYPE; v_now timestamptz := clock_timestamp();
BEGIN
 SELECT * INTO r FROM warehouse_identity.central_grant_requests x WHERE x.central_grant_request_id = p_request_id FOR UPDATE;
 IF r.central_grant_request_id IS NULL OR r.status <> 'OPEN' THEN RAISE EXCEPTION 'CENTRAL_GRANT_REQUEST_NOT_OPEN' USING ERRCODE = '42501'; END IF;
 IF p_approval_ids IS NULL OR cardinality(p_approval_ids) <> 2 OR p_eoc_grant_ids IS NULL
  OR cardinality(p_eoc_grant_ids) <> jsonb_array_length(r.items) OR array_position(p_eoc_grant_ids, NULL) IS NOT NULL
  OR (SELECT count(DISTINCT g) FROM unnest(p_eoc_grant_ids) g) <> cardinality(p_eoc_grant_ids)
  OR (SELECT count(DISTINCT x.approver_user_id) FROM warehouse_identity.central_grant_approvals x
       WHERE x.central_grant_approval_id = ANY (p_approval_ids) AND x.grant_request_id = r.central_grant_request_id
         AND x.consumed_at IS NULL AND x.set_sha256 = r.set_sha256) <> 2
 THEN RAISE EXCEPTION 'CENTRAL_GRANT_RECORD_INVALID' USING ERRCODE = '22023'; END IF;
 UPDATE warehouse_identity.central_grant_approvals SET consumed_at = v_now WHERE central_grant_approval_id = ANY (p_approval_ids);
 UPDATE warehouse_identity.central_grant_requests SET status = 'GRANTED', granted_at = v_now, eoc_grant_ids = p_eoc_grant_ids
  WHERE central_grant_request_id = r.central_grant_request_id;
 RETURN true;
END $fn$;

-- (i) ownership, privileges --------------------------------------------------------------------------------------------------
DO $own$
DECLARE f text;
BEGIN
 FOREACH f IN ARRAY ARRAY[
   'warehouse_identity.central_is_grant_approver_v1(uuid)',
   'warehouse_identity.central_normalize_grant_items_v1(jsonb)',
   'warehouse_identity.central_request_grants_v1(uuid,jsonb,integer,text,uuid,integer)',
   'warehouse_identity.central_cancel_grant_request_v1(uuid)',
   'warehouse_identity.central_grant_request_info_v1(uuid)',
   'warehouse_identity.central_grant_approval_begin_v1(uuid,text,text,bytea,uuid,uuid)',
   'warehouse_identity.central_finalize_grant_approval_v1(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid)',
   'warehouse_identity.central_record_grants_v1(uuid,uuid[],uuid[])'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  EXECUTE format('ALTER FUNCTION %s OWNER TO tcds_identity_function_owner', f);
 END LOOP;
END $own$;
GRANT EXECUTE ON FUNCTION warehouse_identity.central_request_grants_v1(uuid,jsonb,integer,text,uuid,integer),
  warehouse_identity.central_cancel_grant_request_v1(uuid) TO tcds_identity_central_admin;
GRANT EXECUTE ON FUNCTION warehouse_identity.central_grant_request_info_v1(uuid),
  warehouse_identity.central_grant_approval_begin_v1(uuid,text,text,bytea,uuid,uuid),
  warehouse_identity.central_finalize_grant_approval_v1(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid),
  warehouse_identity.central_record_grants_v1(uuid,uuid[],uuid[])
  TO tcds_identity_central_verifier;

DO $down$ BEGIN
 IF NOT (SELECT had_create FROM r630_m) THEN EXECUTE 'REVOKE CREATE ON SCHEMA warehouse_identity FROM tcds_identity_function_owner'; END IF;
 IF (SELECT need FROM r630_m) THEN
  IF (SELECT had FROM r630_m) THEN
   EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT %s, SET %s', current_user,
                  (SELECT m_inherit FROM r630_m)::text, (SELECT m_set FROM r630_m)::text);
  ELSE EXECUTE format('REVOKE tcds_identity_function_owner FROM %I', current_user); END IF;
 END IF;
END $down$;

DO $verify$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid::regprocedure AS f, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig FROM pg_proc p
           WHERE p.pronamespace = 'warehouse_identity'::regnamespace
             AND p.proname IN ('central_is_grant_approver_v1','central_normalize_grant_items_v1','central_request_grants_v1',
                               'central_cancel_grant_request_v1','central_grant_request_info_v1','central_grant_approval_begin_v1',
                               'central_finalize_grant_approval_v1','central_record_grants_v1') LOOP
  IF r.owner <> 'tcds_identity_function_owner' OR NOT r.prosecdef OR r.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
   THEN RAISE EXCEPTION 'R630_FUNCTION_SETUP_WRONG %', r.f; END IF;
  IF has_function_privilege('public', r.f, 'EXECUTE') OR has_function_privilege('anon', r.f, 'EXECUTE')
     OR has_function_privilege('authenticated', r.f, 'EXECUTE') OR has_function_privilege('service_role', r.f, 'EXECUTE')
   THEN RAISE EXCEPTION 'R630_EXECUTE_TOO_BROAD %', r.f; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'warehouse_identity'::regnamespace AND proname IN ('central_is_grant_approver_v1',
     'central_normalize_grant_items_v1','central_request_grants_v1','central_cancel_grant_request_v1','central_grant_request_info_v1',
     'central_grant_approval_begin_v1','central_finalize_grant_approval_v1','central_record_grants_v1')) <> 8
 THEN RAISE EXCEPTION 'R630_FUNCTIONS_MISSING'; END IF;
 IF EXISTS (SELECT 1 FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.roles rol USING (role_id)
             WHERE rol.role_code = 'EOC_MODULE_GRANT_APPROVER') THEN RAISE EXCEPTION 'R630_ROLE_ASSIGNED_AT_INSTALL'; END IF;
END $verify$;
COMMIT;
