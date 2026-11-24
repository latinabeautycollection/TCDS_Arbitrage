-- 644 (ours). Runtime interface for vendor Recovery V1.9.2, replacing vendor 636/638 (NOT applied).
-- Order: 644_pre -> vendor 634, 635, 637, 640, 641 (unchanged) -> 644. Full rollback: 644_rollback.
--
-- Why: the rehearsal on staging (2026-11-22) showed the vendor's three NOLOGIN roles cannot run the vendor code
-- (no row-security rules on password_reset_requests/auth_sessions, SELECT-only grants under FOR UPDATE, no proof SELECT,
-- tcds_login_api has no table access for intake/queue). Instead of broad USING(true) rules on sensitive tables, this
-- follows the rest of Warehouse IAM: tcds_login_api gets EXECUTE on narrow SECURITY DEFINER functions owned by
-- tcds_identity_function_owner, and no table access at all. The three vendor roles are removed.
--
-- Also fixed here:
--  D4  a stale (expired or 5-attempt) code no longer blocks every later code for that contact (604 unique index)
--  D8  every row with a "created + N minutes" CHECK gets created_at and expires_at from ONE clock reading
--      (vendor inserts mix clock_timestamp() with the column default -> intermittent CHECK failures, as in V1.2 P1)
--  D9  a new proof for the same reset replaces a spent/expired browser binding (640 PK is the reset id)
--  D10 intake never surfaces RECOVERY_24H_LIMIT to the HTTP layer (identical 202 for every outcome)
--  stored WebAuthn origin / RP ID are taken from the challenge row, not from the caller
-- Trust note: WebAuthn signature and OTP-code comparison happen in the calling process (it holds the keys). The DB
-- enforces binding (session, device, facility, purpose, request, row version), single use, expiry and attempt limits.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s';
DO $pre$ BEGIN
 IF to_regclass('warehouse_identity.recovery_v192_ledger') IS NULL THEN RAISE EXCEPTION 'R644_RUN_644_PRE_FIRST'; END IF;
 IF to_regclass('warehouse_identity.recovery_action_challenges_v18') IS NULL OR to_regclass('warehouse_identity.recovery_secret_outbox_v18') IS NULL
 OR to_regclass('warehouse_identity.recovery_invitation_refs_v18') IS NULL OR to_regclass('warehouse_identity.recovery_issuance_jobs_v19') IS NULL
 OR to_regclass('warehouse_identity.recovery_claim_bindings_v191') IS NULL
 OR to_regprocedure('warehouse_identity.recovery_proof_eligible_v18(uuid,uuid)') IS NULL
 OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='warehouse_identity' AND table_name='recovery_issuance_jobs_v19' AND column_name='retry_after')
 THEN RAISE EXCEPTION 'R644_VENDOR_634_635_637_640_641_REQUIRED'; END IF;
 IF to_regprocedure('warehouse_identity.recovery_otp_issue_v192(uuid,text,bytea,bytea,bytea,bytea,bytea,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'R644_ALREADY_INSTALLED'; END IF;
 IF has_table_privilege('warehouse_identity.recovery_v192_ledger','SELECT') IS NOT TRUE THEN RAISE EXCEPTION 'R644_LEDGER_UNREADABLE'; END IF;
END $pre$;

-- 1. Remove the vendor role plumbing (634 + 640). Nothing else uses these roles.
DROP POLICY r634_verifier_only ON warehouse_identity.recovery_action_challenges_v18;
DROP POLICY r634_outbox_otp ON warehouse_identity.recovery_secret_outbox_v18;
DROP POLICY r634_outbox_delivery ON warehouse_identity.recovery_secret_outbox_v18;
DROP POLICY r634_invitation_otp ON warehouse_identity.recovery_invitation_refs_v18;
DROP POLICY r640_otp_binding_select ON warehouse_identity.recovery_claim_bindings_v191;
DROP POLICY r640_otp_binding_insert ON warehouse_identity.recovery_claim_bindings_v191;
REVOKE ALL ON warehouse_identity.recovery_action_challenges_v18, warehouse_identity.recovery_secret_outbox_v18,
 warehouse_identity.recovery_invitation_refs_v18, warehouse_identity.recovery_claim_bindings_v191, warehouse_identity.recovery_proofs_v1
 FROM tcds_recovery_verifier_v18, tcds_recovery_otp_v18, tcds_recovery_delivery_v18;
REVOKE ALL ON SCHEMA warehouse_identity FROM tcds_recovery_verifier_v18, tcds_recovery_otp_v18, tcds_recovery_delivery_v18;
DROP ROLE tcds_recovery_verifier_v18;
DROP ROLE tcds_recovery_otp_v18;
DROP ROLE tcds_recovery_delivery_v18;

-- 2. Function-owner privileges (BYPASSRLS role; the rollback revokes whatever the ledger says it did not have).
DO $g$ DECLARE t text; p text; BEGIN
 FOR t, p IN SELECT * FROM (VALUES
  ('recovery_action_challenges_v18','SELECT,INSERT,UPDATE'),('recovery_secret_outbox_v18','SELECT,INSERT,UPDATE'),
  ('recovery_invitation_refs_v18','SELECT,INSERT,UPDATE'),('recovery_issuance_jobs_v19','SELECT,INSERT,UPDATE'),
  ('recovery_claim_bindings_v191','SELECT,INSERT,DELETE'),('recovery_contact_challenges_v1','SELECT,INSERT,UPDATE'),
  ('recovery_proofs_v1','SELECT,INSERT'),('user_recovery_contacts','SELECT'),('password_reset_requests','SELECT,UPDATE'),
  ('users','SELECT'),('employees','SELECT'),('user_role_assignments','SELECT'),('roles','SELECT'),('auth_sessions','SELECT'),
  ('passkeys','SELECT,UPDATE'),('auth_challenges','SELECT,INSERT,UPDATE'),('webauthn_verification_evidence','SELECT,INSERT')) v(t,p)
 LOOP EXECUTE format('GRANT %s ON warehouse_identity.%I TO tcds_identity_function_owner', p, t); END LOOP;
END $g$;
GRANT EXECUTE ON FUNCTION warehouse_identity.request_password_recovery_v62(uuid,text,text,uuid,uuid,uuid),
 warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text) TO tcds_identity_function_owner;

-- ===================================================================================== intake + admin queue
CREATE FUNCTION warehouse_identity.recovery_intake_v192(p_identifier text, p_reason_code text, p_details text,
 p_request_id uuid, p_correlation_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
-- Outcome is for server logs only; the HTTP response must be identical for every outcome.
DECLARE v_id text := btrim(coalesce(p_identifier,'')); v_user uuid;
BEGIN
 IF length(v_id) NOT BETWEEN 2 AND 200 OR p_reason_code IS NULL
  OR p_reason_code NOT IN ('FORGOT_PASSWORD','ACCOUNT_LOCKED','SUSPECTED_COMPROMISE','OTHER')
  OR length(coalesce(p_details,'')) > 1000 OR p_request_id IS NULL OR p_correlation_id IS NULL
 THEN RAISE EXCEPTION 'RECOVERY_INPUT_INVALID' USING ERRCODE = '22023'; END IF;
 SELECT u.user_id INTO v_user FROM warehouse_identity.users u JOIN warehouse_identity.employees e ON e.user_id = u.user_id
  WHERE u.status = 'ACTIVE' AND e.employment_status = 'ACTIVE'
    AND (u.normalized_username = lower(v_id) OR upper(btrim(e.employee_number)) = upper(v_id))
  ORDER BY (u.normalized_username = lower(v_id)) DESC LIMIT 1;
 IF v_user IS NULL THEN RETURN 'NO_ACCOUNT'; END IF;
 BEGIN
  PERFORM warehouse_identity.request_password_recovery_v62(v_user, p_reason_code, coalesce(p_details,''), NULL, p_request_id, p_correlation_id);
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM = 'RECOVERY_24H_LIMIT' THEN RETURN 'LIMITED'; END IF; RAISE;
 END;
 RETURN 'ACCEPTED';
END $fn$;

-- Admin queue / single review. Actor comes from the session row, never from the caller.
CREATE FUNCTION warehouse_identity.recovery_queue_v192(p_session uuid, p_facility uuid, p_permission text,
 p_request uuid, p_after_at timestamptz, p_after_id uuid, p_limit integer)
RETURNS TABLE(request_id uuid, user_id uuid, row_version bigint, status text, facility_id uuid, employee_display_id text,
 reason_code text, reason text, requested_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
 SELECT r.password_reset_request_id, r.user_id, r.row_version, r.status, e.facility_id, e.employee_number, r.reason_code, r.reason, r.created_at
 FROM warehouse_identity.password_reset_requests r
 JOIN warehouse_identity.employees e ON e.user_id = r.user_id AND e.employment_status = 'ACTIVE' AND e.facility_id = p_facility
 JOIN warehouse_identity.auth_sessions s ON s.auth_session_id = p_session AND s.revoked_at IS NULL
   AND s.idle_expires_at > clock_timestamp() AND s.absolute_expires_at > clock_timestamp()
 WHERE p_permission IN ('warehouse:identity:password:reset_approve','warehouse:identity:password:override_24h')
   AND p_limit BETWEEN 1 AND 51
   AND r.user_id <> s.user_id
   AND EXISTS (SELECT 1 FROM warehouse_identity.user_role_assignments a JOIN warehouse_identity.roles ro ON ro.role_id = a.role_id
     WHERE a.user_id = s.user_id AND a.facility_id = e.facility_id AND a.revoked_at IS NULL AND a.valid_from <= clock_timestamp()
       AND (a.valid_until IS NULL OR a.valid_until > clock_timestamp()) AND ro.active AND p_permission = ANY(ro.permissions))
   AND (p_request IS NULL OR r.password_reset_request_id = p_request)
   AND (p_request IS NOT NULL OR r.status = 'REQUESTED')
   AND (p_after_at IS NULL OR (r.created_at, r.password_reset_request_id) > (p_after_at, p_after_id))
 ORDER BY r.created_at, r.password_reset_request_id
 LIMIT CASE WHEN p_request IS NULL THEN p_limit ELSE 1 END
$fn$;

-- ===================================================================================== WebAuthn step-up
-- Checks the approver's session, device, facility and permission for the purpose; returns the target and the
-- approver's passkey credential ids on THIS device (the caller builds the WebAuthn options from them).
CREATE FUNCTION warehouse_identity.recovery_stepup_options_v192(p_session uuid, p_device uuid, p_facility uuid,
 p_purpose text, p_request uuid)
RETURNS TABLE(actor_user_id uuid, target_user_id uuid, row_version bigint, credential_ids text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
#variable_conflict use_column
DECLARE v_actor uuid; v_perm text; v_target uuid; v_rv bigint; v_status text; v_creds text[];
BEGIN
 IF p_purpose NOT IN ('WAREHOUSE_PASSWORD_RESET_APPROVAL','RECOVERY_24H_OVERRIDE') THEN RAISE EXCEPTION 'STEPUP_PURPOSE_INVALID' USING ERRCODE='22023'; END IF;
 v_perm := CASE p_purpose WHEN 'WAREHOUSE_PASSWORD_RESET_APPROVAL' THEN 'warehouse:identity:password:reset_approve' ELSE 'warehouse:identity:password:override_24h' END;
 SELECT s.user_id INTO v_actor FROM warehouse_identity.auth_sessions s JOIN warehouse_identity.employees e ON e.user_id = s.user_id
  WHERE s.auth_session_id = p_session AND s.device_id = p_device AND s.revoked_at IS NULL
    AND s.idle_expires_at > clock_timestamp() AND s.absolute_expires_at > clock_timestamp()
    AND e.facility_id = p_facility AND e.employment_status = 'ACTIVE';
 IF v_actor IS NULL THEN RAISE EXCEPTION 'STEPUP_SESSION_INVALID' USING ERRCODE='42501'; END IF;
 SELECT q.user_id, q.row_version, q.status INTO v_target, v_rv, v_status
  FROM warehouse_identity.recovery_queue_v192(p_session, p_facility, v_perm, p_request, NULL, NULL, 1) q;
 IF v_target IS NULL THEN RAISE EXCEPTION 'RECOVERY_REVIEW_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 IF p_purpose = 'WAREHOUSE_PASSWORD_RESET_APPROVAL' AND v_status <> 'REQUESTED' THEN RAISE EXCEPTION 'STALE_OR_INVALID_STATE' USING ERRCODE='40001'; END IF;
 SELECT array_agg(pk.credential_id ORDER BY pk.credential_id) INTO v_creds FROM warehouse_identity.passkeys pk
  WHERE pk.user_id = v_actor AND pk.enrolled_device_id = p_device AND pk.revoked_at IS NULL AND pk.security_state = 'ACTIVE';
 IF v_creds IS NULL THEN RAISE EXCEPTION 'APPROVER_PASSKEY_NOT_ENROLLED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT v_actor, v_target, v_rv, v_creds;
END $fn$;

CREATE FUNCTION warehouse_identity.recovery_stepup_begin_v192(p_session uuid, p_device uuid, p_facility uuid, p_purpose text,
 p_request uuid, p_expected_row_version bigint, p_challenge_text text, p_origin text, p_rp_id text, p_correlation uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE o record; v_now timestamptz := clock_timestamp(); v_auth uuid := gen_random_uuid(); v_ch uuid := gen_random_uuid();
BEGIN
 IF p_challenge_text IS NULL OR length(p_challenge_text) NOT BETWEEN 32 AND 256 OR p_correlation IS NULL
  OR coalesce(p_origin,'') !~ '^https://' OR length(coalesce(p_rp_id,'')) < 3
 THEN RAISE EXCEPTION 'STEPUP_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO o FROM warehouse_identity.recovery_stepup_options_v192(p_session, p_device, p_facility, p_purpose, p_request);
 IF o.row_version IS DISTINCT FROM p_expected_row_version THEN RAISE EXCEPTION 'STALE_RESET_VERSION' USING ERRCODE='40001'; END IF;
 INSERT INTO warehouse_identity.auth_challenges(auth_challenge_id, user_id, device_id, ceremony_type, challenge_hash,
   expected_origin, expected_rp_id, request_id, correlation_id, created_at, expires_at)
 VALUES (v_auth, o.actor_user_id, p_device, 'PASSKEY_AUTHENTICATION', sha256(convert_to(p_challenge_text,'UTF8')),
   p_origin, p_rp_id, p_request, p_correlation, v_now, v_now + interval '2 minutes');
 INSERT INTO warehouse_identity.recovery_action_challenges_v18(challenge_id, auth_challenge_id, actor_user_id, auth_session_id, device_id,
   facility_id, target_user_id, reset_request_id, context_request_id, expected_row_version, purpose, challenge_text, created_at, expires_at)
 VALUES (v_ch, v_auth, o.actor_user_id, p_session, p_device, p_facility, o.target_user_id,
   CASE WHEN p_purpose = 'WAREHOUSE_PASSWORD_RESET_APPROVAL' THEN p_request END, p_request, o.row_version::text, p_purpose,
   p_challenge_text, v_now, v_now + interval '2 minutes');
 RETURN v_ch;
END $fn$;

-- Call inside the caller's transaction: locks the challenge and the passkey until COMMIT/ROLLBACK.
CREATE FUNCTION warehouse_identity.recovery_stepup_load_v192(p_session uuid, p_device uuid, p_challenge uuid, p_credential_id text)
RETURNS TABLE(challenge_text text, expected_origin text, expected_rp_id text, passkey_id uuid, public_key bytea, sign_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
#variable_conflict use_column
DECLARE c record; k record;
BEGIN
 SELECT ac.challenge_text, ac.actor_user_id, a.expected_origin, a.expected_rp_id INTO c
  FROM warehouse_identity.recovery_action_challenges_v18 ac JOIN warehouse_identity.auth_challenges a ON a.auth_challenge_id = ac.auth_challenge_id
  WHERE ac.challenge_id = p_challenge AND ac.auth_session_id = p_session AND ac.device_id = p_device
    AND ac.consumed_at IS NULL AND ac.expires_at > clock_timestamp() FOR UPDATE OF ac;
 IF NOT FOUND THEN RAISE EXCEPTION 'STEPUP_CHALLENGE_INVALID' USING ERRCODE='42501'; END IF;
 IF p_credential_id IS NULL OR length(p_credential_id) > 1024 THEN RAISE EXCEPTION 'STEPUP_CREDENTIAL_INVALID' USING ERRCODE='22023'; END IF;
 SELECT pk.passkey_id, pk.public_key, pk.sign_count INTO k FROM warehouse_identity.passkeys pk
  WHERE pk.user_id = c.actor_user_id AND pk.enrolled_device_id = p_device AND pk.credential_id = p_credential_id
    AND pk.revoked_at IS NULL AND pk.security_state = 'ACTIVE' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STEPUP_CREDENTIAL_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT c.challenge_text, c.expected_origin, c.expected_rp_id, k.passkey_id, k.public_key, k.sign_count;
END $fn$;

-- After the caller verified the assertion (same transaction as _load): counter, evidence, single use, 6.2 registration.
CREATE FUNCTION warehouse_identity.recovery_stepup_finish_v192(p_session uuid, p_device uuid, p_challenge uuid, p_passkey_id uuid,
 p_new_counter bigint, p_user_verified boolean, p_authenticator_data_sha256 text, p_client_data_json_sha256 text,
 p_signature_sha256 text, p_verifier_version text, p_correlation uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE c record; k record; v_ev uuid := gen_random_uuid(); v_ok boolean;
BEGIN
 IF p_user_verified IS NOT TRUE THEN RAISE EXCEPTION 'STEPUP_USER_VERIFICATION_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_correlation IS NULL OR p_new_counter IS NULL OR p_new_counter < 0 THEN RAISE EXCEPTION 'STEPUP_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT ac.*, a.expected_origin, a.expected_rp_id INTO c
  FROM warehouse_identity.recovery_action_challenges_v18 ac JOIN warehouse_identity.auth_challenges a ON a.auth_challenge_id = ac.auth_challenge_id
  WHERE ac.challenge_id = p_challenge AND ac.auth_session_id = p_session AND ac.device_id = p_device
    AND ac.consumed_at IS NULL AND ac.expires_at > clock_timestamp() FOR UPDATE OF ac;
 IF NOT FOUND THEN RAISE EXCEPTION 'STEPUP_CHALLENGE_INVALID' USING ERRCODE='42501'; END IF;
 SELECT pk.passkey_id, pk.credential_id, pk.sign_count INTO k FROM warehouse_identity.passkeys pk
  WHERE pk.passkey_id = p_passkey_id AND pk.user_id = c.actor_user_id AND pk.enrolled_device_id = p_device
    AND pk.revoked_at IS NULL AND pk.security_state = 'ACTIVE' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STEPUP_CREDENTIAL_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 IF k.sign_count > 0 AND p_new_counter <= k.sign_count THEN RAISE EXCEPTION 'STEPUP_COUNTER_REPLAY' USING ERRCODE='42501'; END IF;
 UPDATE warehouse_identity.passkeys SET sign_count = p_new_counter, last_used_at = clock_timestamp(), row_version = row_version + 1
  WHERE passkey_id = k.passkey_id;
 INSERT INTO warehouse_identity.webauthn_verification_evidence(webauthn_verification_evidence_id, auth_challenge_id, ceremony_type, user_id,
   passkey_id, credential_id, verified_origin, verified_rp_id, user_verified, authenticator_data_sha256, client_data_json_sha256,
   signature_sha256, prior_sign_count, observed_sign_count, verifier_service, verifier_version, verifier_instance_id, request_id,
   correlation_id, verified_at)
 VALUES (v_ev, c.auth_challenge_id, 'PASSKEY_AUTHENTICATION', c.actor_user_id, k.passkey_id, k.credential_id, c.expected_origin,
   c.expected_rp_id, true, p_authenticator_data_sha256, p_client_data_json_sha256, p_signature_sha256, k.sign_count, p_new_counter,
   'tcds-warehouse-recovery-stepup', left(coalesce(p_verifier_version,'unknown'),40), p_device, c.context_request_id, p_correlation, clock_timestamp());
 UPDATE warehouse_identity.recovery_action_challenges_v18 SET consumed_at = clock_timestamp() WHERE challenge_id = p_challenge;
 v_ok := warehouse_identity.register_password_recovery_stepup_v62(v_ev, p_session, c.target_user_id, c.reset_request_id,
   CASE c.purpose WHEN 'WAREHOUSE_PASSWORD_RESET_APPROVAL' THEN 'APPROVE' ELSE 'OVERRIDE' END, p_challenge, 'tcds-warehouse-recovery-stepup');
 IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'STEPUP_REGISTRATION_REJECTED' USING ERRCODE='42501'; END IF;
 RETURN v_ev;
END $fn$;

-- ===================================================================================== recovery contact + OTP
CREATE FUNCTION warehouse_identity.recovery_contact_eligible_v192(p_request uuid, p_channel text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
 SELECT EXISTS (SELECT 1 FROM warehouse_identity.password_reset_requests r
  JOIN warehouse_identity.user_recovery_contacts c ON c.user_id = r.user_id
  WHERE r.password_reset_request_id = p_request AND r.status = 'REQUESTED' AND c.contact_type = p_channel
    AND c.status = 'VERIFIED' AND c.revoked_at IS NULL AND c.recovery_eligible_at <= clock_timestamp())
$fn$;

-- One code per approved reset. p_payload = AES-GCM(code + invitation reference) sealed by the caller; the destination
-- is NOT copied into the outbox (the delivery claim reads it from the contact).
CREATE FUNCTION warehouse_identity.recovery_otp_issue_v192(p_request uuid, p_channel text, p_otp_hash bytea, p_otp_salt bytea,
 p_payload bytea, p_payload_iv bytea, p_payload_tag bytea, p_correlation uuid)
RETURNS TABLE(challenge_id uuid, delivery_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
#variable_conflict use_column
DECLARE v_user uuid; v_contact uuid; v_ch uuid; v_del uuid := gen_random_uuid(); v_now timestamptz;
BEGIN
 IF p_channel NOT IN ('EMAIL','SMS') OR octet_length(p_otp_hash) <> 32 OR octet_length(p_otp_salt) <> 16 OR p_payload IS NULL
  OR octet_length(p_payload_iv) <> 12 OR octet_length(p_payload_tag) <> 16 OR p_correlation IS NULL
 THEN RAISE EXCEPTION 'OTP_ISSUE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT r.user_id INTO v_user FROM warehouse_identity.password_reset_requests r
  WHERE r.password_reset_request_id = p_request AND r.status = 'TOKEN_ISSUED' AND r.expires_at > clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESET_NOT_APPROVED' USING ERRCODE='42501'; END IF;
 SELECT c.contact_id INTO v_contact FROM warehouse_identity.user_recovery_contacts c
  WHERE c.user_id = v_user AND c.contact_type = p_channel AND c.status = 'VERIFIED' AND c.revoked_at IS NULL
    AND c.recovery_eligible_at <= clock_timestamp() ORDER BY c.verified_at DESC, c.contact_id LIMIT 1;
 IF v_contact IS NULL THEN RAISE EXCEPTION 'VERIFIED_RECOVERY_DESTINATION_REQUIRED' USING ERRCODE='42501'; END IF;
 -- D4: close codes that can never be used again (expired, or out of attempts) so they stop holding the 604 index.
 UPDATE warehouse_identity.recovery_contact_challenges_v1 SET consumed_at = clock_timestamp()
  WHERE contact_id = v_contact AND purpose = 'PASSWORD_RESET' AND consumed_at IS NULL
    AND (expires_at <= clock_timestamp() OR attempt_count >= 5);
 IF EXISTS (SELECT 1 FROM warehouse_identity.recovery_contact_challenges_v1 ch WHERE ch.contact_id = v_contact
   AND ch.purpose = 'PASSWORD_RESET' AND ch.consumed_at IS NULL AND ch.delivery_state IN ('PENDING','ACCEPTED','UNKNOWN'))
 THEN RAISE EXCEPTION 'RECOVERY_CHALLENGE_ALREADY_OUTSTANDING' USING ERRCODE='55000'; END IF;
 INSERT INTO warehouse_identity.recovery_contact_challenges_v1(user_id, contact_id, purpose, reset_request_id, otp_hash, otp_salt, expires_at, delivery_state)
 VALUES (v_user, v_contact, 'PASSWORD_RESET', p_request, p_otp_hash, p_otp_salt, clock_timestamp() + interval '10 minutes', 'PENDING')
 RETURNING recovery_contact_challenges_v1.challenge_id INTO v_ch;   -- 614 trigger sets created_at/expires_at
 v_now := clock_timestamp();
 INSERT INTO warehouse_identity.recovery_secret_outbox_v18(delivery_id, challenge_id, channel, encrypted_payload, payload_iv, payload_tag,
   correlation_id, created_at, expires_at)
 VALUES (v_del, v_ch, p_channel, p_payload, p_payload_iv, p_payload_tag, p_correlation, v_now,
   least(v_now + interval '10 minutes', (SELECT expires_at FROM warehouse_identity.recovery_contact_challenges_v1 WHERE challenge_id = v_ch)));
 RETURN QUERY SELECT v_ch, v_del;
END $fn$;

-- Call inside the caller's transaction, then _otp_settle with the caller's constant-time comparison result.
CREATE FUNCTION warehouse_identity.recovery_otp_load_v192(p_request uuid)
RETURNS TABLE(challenge_id uuid, otp_hash bytea, otp_salt bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
#variable_conflict use_column
BEGIN
 RETURN QUERY SELECT ch.challenge_id, ch.otp_hash, ch.otp_salt
  FROM warehouse_identity.recovery_contact_challenges_v1 ch
  JOIN warehouse_identity.user_recovery_contacts c ON c.contact_id = ch.contact_id AND c.user_id = ch.user_id
  JOIN warehouse_identity.password_reset_requests r ON r.password_reset_request_id = ch.reset_request_id AND r.user_id = ch.user_id
  WHERE ch.reset_request_id = p_request AND ch.purpose = 'PASSWORD_RESET' AND ch.consumed_at IS NULL AND ch.attempt_count < 5
    AND ch.expires_at > clock_timestamp() AND ch.delivery_state = 'ACCEPTED'
    AND c.status = 'VERIFIED' AND c.revoked_at IS NULL AND c.recovery_eligible_at <= clock_timestamp()
    AND r.status = 'TOKEN_ISSUED' AND r.expires_at > clock_timestamp()
  ORDER BY ch.created_at DESC LIMIT 1 FOR UPDATE OF ch;
 IF NOT FOUND THEN RAISE EXCEPTION 'OTP_UNAVAILABLE' USING ERRCODE='42501'; END IF;
END $fn$;

CREATE FUNCTION warehouse_identity.recovery_otp_settle_v192(p_request uuid, p_challenge uuid, p_match boolean, p_binding_hash bytea)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE ch record; v_proof uuid := gen_random_uuid(); v_now timestamptz;
BEGIN
 IF p_match IS NULL OR octet_length(p_binding_hash) <> 32 THEN RAISE EXCEPTION 'OTP_SETTLE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT x.user_id, c.contact_type INTO ch FROM warehouse_identity.recovery_contact_challenges_v1 x
  JOIN warehouse_identity.user_recovery_contacts c ON c.contact_id = x.contact_id
  WHERE x.challenge_id = p_challenge AND x.reset_request_id = p_request AND x.purpose = 'PASSWORD_RESET' AND x.consumed_at IS NULL
    AND x.attempt_count < 5 AND x.expires_at > clock_timestamp() AND x.delivery_state = 'ACCEPTED' FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'OTP_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF NOT p_match THEN
  UPDATE warehouse_identity.recovery_contact_challenges_v1 SET attempt_count = attempt_count + 1 WHERE challenge_id = p_challenge;
  RETURN NULL;
 END IF;
 UPDATE warehouse_identity.recovery_contact_challenges_v1 SET consumed_at = clock_timestamp() WHERE challenge_id = p_challenge;
 INSERT INTO warehouse_identity.recovery_proofs_v1(proof_id, user_id, reset_request_id, challenge_id, assurance_method, expires_at)
 VALUES (v_proof, ch.user_id, p_request, p_challenge,
   CASE ch.contact_type WHEN 'EMAIL' THEN 'VERIFIED_EMAIL_CODE' ELSE 'VERIFIED_SMS_CODE' END, clock_timestamp() + interval '5 minutes');
 -- D9: a binding left by a spent or expired proof must not block this reset's new proof (640 PK = reset id).
 DELETE FROM warehouse_identity.recovery_claim_bindings_v191 b WHERE b.reset_request_id = p_request
   AND (b.expires_at <= clock_timestamp() OR EXISTS (SELECT 1 FROM warehouse_identity.recovery_proofs_v1 p
        WHERE p.proof_id = b.proof_id AND (p.consumed_at IS NOT NULL OR p.expires_at <= clock_timestamp())));
 v_now := clock_timestamp();
 INSERT INTO warehouse_identity.recovery_claim_bindings_v191(reset_request_id, proof_id, challenge_id, binding_hash, created_at, expires_at)
 VALUES (p_request, v_proof, p_challenge, p_binding_hash, v_now, v_now + interval '5 minutes');
 RETURN v_proof;
END $fn$;

CREATE FUNCTION warehouse_identity.recovery_bound_proof_v192(p_request uuid, p_binding_hash bytea) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
 SELECT b.proof_id FROM warehouse_identity.recovery_claim_bindings_v191 b
  JOIN warehouse_identity.recovery_proofs_v1 p ON p.proof_id = b.proof_id
  JOIN warehouse_identity.password_reset_requests r ON r.password_reset_request_id = b.reset_request_id
  WHERE b.reset_request_id = p_request AND b.binding_hash = p_binding_hash AND b.expires_at > clock_timestamp()
    AND p.consumed_at IS NULL AND p.expires_at > clock_timestamp() AND r.status = 'TOKEN_ISSUED' AND r.expires_at > clock_timestamp()
$fn$;

-- ===================================================================================== invitation reference
CREATE FUNCTION warehouse_identity.recovery_invitation_issue_v192(p_request uuid, p_ref_hash bytea) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE v_exp timestamptz; v_now timestamptz;
BEGIN
 IF octet_length(p_ref_hash) <> 32 THEN RAISE EXCEPTION 'INVITATION_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT r.expires_at INTO v_exp FROM warehouse_identity.password_reset_requests r
  WHERE r.password_reset_request_id = p_request AND r.status = 'TOKEN_ISSUED' AND r.expires_at > clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_ISSUE_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 UPDATE warehouse_identity.recovery_invitation_refs_v18 SET revoked_at = clock_timestamp() WHERE reset_request_id = p_request AND revoked_at IS NULL;
 v_now := clock_timestamp();
 INSERT INTO warehouse_identity.recovery_invitation_refs_v18(reset_request_id, ref_hash, created_at, expires_at)
 VALUES (p_request, p_ref_hash, v_now, least(v_exp, v_now + interval '15 minutes'));
 RETURN least(v_exp, v_now + interval '15 minutes');
END $fn$;

CREATE FUNCTION warehouse_identity.recovery_invitation_resolve_v192(p_ref_hash bytea) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
 SELECT i.reset_request_id FROM warehouse_identity.recovery_invitation_refs_v18 i
  JOIN warehouse_identity.password_reset_requests r ON r.password_reset_request_id = i.reset_request_id
  WHERE i.ref_hash = p_ref_hash AND i.revoked_at IS NULL AND i.expires_at > clock_timestamp()
    AND r.status = 'TOKEN_ISSUED' AND r.expires_at > clock_timestamp()
$fn$;

CREATE FUNCTION warehouse_identity.recovery_invitation_revoke_v192(p_request uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
 WITH u AS (UPDATE warehouse_identity.recovery_invitation_refs_v18 SET revoked_at = clock_timestamp()
  WHERE reset_request_id = p_request AND revoked_at IS NULL RETURNING 1) SELECT count(*)::integer FROM u
$fn$;

-- ===================================================================================== issuance job (approval -> code)
CREATE FUNCTION warehouse_identity.recovery_issuance_intent_v192(p_request uuid, p_correlation uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
 IF p_correlation IS NULL THEN RAISE EXCEPTION 'ISSUANCE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 INSERT INTO warehouse_identity.recovery_issuance_jobs_v19(reset_request_id, correlation_id, status)
 SELECT r.password_reset_request_id, p_correlation, 'WAITING_APPROVAL' FROM warehouse_identity.password_reset_requests r
  WHERE r.password_reset_request_id = p_request AND r.status = 'REQUESTED'
 ON CONFLICT (reset_request_id) DO NOTHING;
 IF FOUND THEN RETURN 'RECORDED'; END IF;
 IF EXISTS (SELECT 1 FROM warehouse_identity.recovery_issuance_jobs_v19 WHERE reset_request_id = p_request) THEN RETURN 'EXISTS'; END IF;
 RAISE EXCEPTION 'ISSUANCE_INTENT_UNAVAILABLE' USING ERRCODE='55000';
END $fn$;

CREATE FUNCTION warehouse_identity.recovery_issuance_lease_v192()
RETURNS TABLE(reset_request_id uuid, correlation_id uuid, code_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
#variable_conflict use_column
DECLARE j record;
BEGIN
 SELECT jb.reset_request_id, jb.correlation_id INTO j FROM warehouse_identity.recovery_issuance_jobs_v19 jb
  JOIN warehouse_identity.password_reset_requests r ON r.password_reset_request_id = jb.reset_request_id
  WHERE (jb.status = 'WAITING_APPROVAL' OR (jb.status = 'WORKING' AND jb.leased_until < clock_timestamp())
     OR (jb.status = 'BLOCKED' AND jb.retry_after <= clock_timestamp())) AND jb.attempts < 5
    AND r.status = 'TOKEN_ISSUED' AND r.expires_at > clock_timestamp()
  ORDER BY jb.created_at, jb.reset_request_id FOR UPDATE OF jb SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE warehouse_identity.recovery_issuance_jobs_v19 SET status = 'WORKING', leased_until = clock_timestamp() + interval '60 seconds',
   retry_after = NULL, last_error_class = NULL, attempts = attempts + 1, updated_at = clock_timestamp()
  WHERE reset_request_id = j.reset_request_id;
 -- NONE = no code yet (issue one); LIVE = a code exists and is usable (do not issue); REVIEW = unknown/failed/expired.
 RETURN QUERY SELECT j.reset_request_id, j.correlation_id, coalesce((
   SELECT CASE WHEN o.status IN ('UNKNOWN','FAILED') OR c.expires_at <= clock_timestamp() THEN 'REVIEW' ELSE 'LIVE' END
   FROM warehouse_identity.recovery_contact_challenges_v1 c JOIN warehouse_identity.recovery_secret_outbox_v18 o ON o.challenge_id = c.challenge_id
   WHERE c.reset_request_id = j.reset_request_id AND c.purpose = 'PASSWORD_RESET' ORDER BY c.created_at DESC LIMIT 1), 'NONE');
END $fn$;

CREATE FUNCTION warehouse_identity.recovery_issuance_settle_v192(p_request uuid, p_outcome text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
 IF p_outcome NOT IN ('PREPARED','TRANSIENT','POLICY_BLOCKED') THEN RAISE EXCEPTION 'ISSUANCE_OUTCOME_INVALID' USING ERRCODE='22023'; END IF;
 UPDATE warehouse_identity.recovery_issuance_jobs_v19 SET
   status = CASE WHEN p_outcome = 'PREPARED' THEN 'PREPARED' ELSE 'BLOCKED' END, leased_until = NULL,
   last_error_class = CASE WHEN p_outcome = 'PREPARED' THEN NULL ELSE p_outcome END,
   retry_after = CASE WHEN p_outcome = 'TRANSIENT' AND attempts < 5
     THEN clock_timestamp() + (LEAST(300, 30 * power(2, attempts - 1))::integer * interval '1 second') END,
   updated_at = clock_timestamp()
  WHERE reset_request_id = p_request AND status = 'WORKING';
 IF NOT FOUND THEN RAISE EXCEPTION 'ISSUANCE_JOB_NOT_LEASED' USING ERRCODE='55000'; END IF;
END $fn$;

-- ===================================================================================== delivery worker
CREATE FUNCTION warehouse_identity.recovery_delivery_claim_v192()
RETURNS TABLE(delivery_id uuid, challenge_id uuid, channel text, encrypted_payload bytea, payload_iv bytea, payload_tag bytea,
 destination_ciphertext bytea, destination_iv bytea, destination_tag bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
#variable_conflict use_column
DECLARE d record;
BEGIN
 SELECT o.delivery_id INTO d FROM warehouse_identity.recovery_secret_outbox_v18 o
  WHERE o.status = 'PENDING' AND o.expires_at > clock_timestamp() ORDER BY o.created_at, o.delivery_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE warehouse_identity.recovery_secret_outbox_v18 SET status = 'SENDING', attempt_count = attempt_count + 1, send_started_at = clock_timestamp()
  WHERE delivery_id = d.delivery_id;
 RETURN QUERY SELECT o.delivery_id, o.challenge_id, o.channel, o.encrypted_payload, o.payload_iv, o.payload_tag, c.ciphertext, c.iv, c.tag
  FROM warehouse_identity.recovery_secret_outbox_v18 o
  JOIN warehouse_identity.recovery_contact_challenges_v1 ch ON ch.challenge_id = o.challenge_id
  JOIN warehouse_identity.user_recovery_contacts c ON c.contact_id = ch.contact_id
  WHERE o.delivery_id = d.delivery_id;
END $fn$;

CREATE FUNCTION warehouse_identity.recovery_delivery_settle_v192(p_delivery uuid, p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE v_ch uuid;
BEGIN
 IF p_status NOT IN ('ACCEPTED','FAILED','UNKNOWN') THEN RAISE EXCEPTION 'DELIVERY_STATUS_INVALID' USING ERRCODE='22023'; END IF;
 UPDATE warehouse_identity.recovery_secret_outbox_v18 SET status = p_status, processed_at = clock_timestamp(),
   encrypted_payload = NULL, payload_iv = NULL, payload_tag = NULL
  WHERE delivery_id = p_delivery AND status = 'SENDING' RETURNING challenge_id INTO v_ch;
 IF v_ch IS NULL THEN RAISE EXCEPTION 'DELIVERY_NOT_SENDING' USING ERRCODE='55000'; END IF;
 UPDATE warehouse_identity.recovery_contact_challenges_v1 SET delivery_state = p_status WHERE challenge_id = v_ch AND delivery_state = 'PENDING';
END $fn$;

-- A SENDING row older than the lease has an unknown provider outcome: never resend it automatically.
CREATE FUNCTION warehouse_identity.recovery_delivery_quarantine_v192(p_lease_seconds integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE n integer;
BEGIN
 IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN RAISE EXCEPTION 'DELIVERY_LEASE_INVALID' USING ERRCODE='22023'; END IF;
 WITH q AS (UPDATE warehouse_identity.recovery_secret_outbox_v18 SET status = 'UNKNOWN', processed_at = clock_timestamp(),
     encrypted_payload = NULL, payload_iv = NULL, payload_tag = NULL
   WHERE status = 'SENDING' AND send_started_at < clock_timestamp() - p_lease_seconds * interval '1 second' RETURNING challenge_id),
  c AS (UPDATE warehouse_identity.recovery_contact_challenges_v1 ch SET delivery_state = 'UNKNOWN' FROM q
   WHERE ch.challenge_id = q.challenge_id AND ch.delivery_state = 'PENDING' RETURNING 1)
 SELECT count(*) INTO n FROM q;
 RETURN n;
END $fn$;

-- 3. Ownership + execution: function owner only; EXECUTE for tcds_login_api only.
DO $own$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'warehouse_identity'::regnamespace AND p.proname LIKE 'recovery\_%\_v192' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO tcds_identity_function_owner', f);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO tcds_login_api', f);
 END LOOP;
END $own$;

DO $verify$ DECLARE f record; n integer := 0; BEGIN
 FOR f IN SELECT p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner FROM pg_proc p
   WHERE p.pronamespace = 'warehouse_identity'::regnamespace AND p.proname LIKE 'recovery\_%\_v192' LOOP
  n := n + 1;
  IF NOT f.prosecdef OR f.owner <> 'tcds_identity_function_owner' OR NOT has_function_privilege('tcds_login_api', f.oid, 'EXECUTE')
   OR has_function_privilege('anon', f.oid, 'EXECUTE') OR has_function_privilege('authenticated', f.oid, 'EXECUTE')
   OR has_function_privilege('service_role', f.oid, 'EXECUTE') OR has_function_privilege('public', f.oid, 'EXECUTE')
  THEN RAISE EXCEPTION 'R644_FUNCTION_SECURITY_WRONG:%', f.proname; END IF;
 END LOOP;
 IF n <> 20 THEN RAISE EXCEPTION 'R644_EXPECTED_20_FUNCTIONS_GOT_%', n; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname LIKE 'tcds\_recovery\_%\_v18') THEN RAISE EXCEPTION 'R644_VENDOR_ROLES_REMAIN'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'warehouse_identity' AND (policyname LIKE 'r634\_%' OR policyname LIKE 'r640\_%'))
 THEN RAISE EXCEPTION 'R644_VENDOR_POLICIES_REMAIN'; END IF;
 IF has_table_privilege('tcds_login_api','warehouse_identity.recovery_secret_outbox_v18','SELECT')
 OR has_table_privilege('tcds_login_api','warehouse_identity.recovery_claim_bindings_v191','SELECT')
 THEN RAISE EXCEPTION 'R644_LOGIN_API_HAS_DIRECT_TABLE_ACCESS'; END IF;
END $verify$;
COMMIT;
