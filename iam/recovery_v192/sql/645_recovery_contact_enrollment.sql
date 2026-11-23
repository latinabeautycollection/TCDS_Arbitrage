-- 645 (ours). STAGING FIRST. Recovery-email enrollment for warehouse password recovery (V1.9.2 + 644).
-- Decided 2026-11-22 (Anthony): employees add their own recovery email in the app while signed in and confirm it with a
-- code sent to it; then an approver approves it with a passkey before it can be used. Anthony is the only approver for
-- now; approvals happen on the existing login-stg approval page with the central laptop passkey (626/628 ceremony).
-- Requires 604-622, 626 (central passkeys), 634/637/640/641 + 644. Changes (no vendor table or function is altered):
--   roles                               + IAM_RECOVERY_DESTINATION_APPROVER (warehouse:identity:recovery_destination:approve),
--                                         assigned to nobody here (the operator assigns it, globally)
--   recovery_contact_policy_v645        one row: required approvals (1 now; 2 later = one UPDATE), eligibility delay
--   recovery_contact_enrollments_v645   one enrollment per email: code -> approval -> APPROVED | CANCELLED | EXPIRED
--   recovery_contact_approvals_v645     one row per approver per enrollment (passkey evidence); a second column of the
--                                         vendor two-approver idea, without its single fixed pair
--   central_challenge_context           + purpose RECOVERY_CONTACT_APPROVAL, bound to one enrollment
--   functions (owner tcds_identity_function_owner, SECURITY DEFINER, search_path pg_catalog):
--     login API  recovery_contact_overview/start/code_load/code_settle/cancel_v645            -> tcds_login_api
--     verifier   central_recovery_contact_info/approval_begin/finalize_approval_v645          -> tcds_identity_central_verifier
-- The vendor table recovery_destination_reviews_v11 (and its two-approver CHECK) is left untouched and unused.
-- When enough approvals exist, the contact becomes VERIFIED + eligible, the user's other email contacts are revoked,
-- and a security event is written. Full rollback: 645_rollback.sql.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
 IF to_regclass('warehouse_identity.recovery_v192_ledger') IS NULL THEN RAISE EXCEPTION 'R645_644_NOT_INSTALLED'; END IF;
 IF to_regclass('warehouse_identity.central_challenge_context') IS NULL OR to_regprocedure('warehouse_identity.central_held_claim_v1(uuid,bytea,bigint,text)') IS NULL
 THEN RAISE EXCEPTION 'R645_626_NOT_INSTALLED'; END IF;
 IF to_regclass('warehouse_identity.recovery_contact_enrollments_v645') IS NOT NULL THEN RAISE EXCEPTION 'R645_ALREADY_INSTALLED'; END IF;
 IF EXISTS (SELECT 1 FROM warehouse_identity.roles WHERE role_code = 'IAM_RECOVERY_DESTINATION_APPROVER') THEN RAISE EXCEPTION 'R645_ROLE_EXISTS_RECONCILE'; END IF;
 IF NOT pg_has_role(current_user, 'tcds_identity_function_owner', 'SET') THEN RAISE EXCEPTION 'R645_NEEDS_SET_ON_FUNCTION_OWNER'; END IF;
 IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'central_challenge_context_purpose_check'
      AND conrelid = 'warehouse_identity.central_challenge_context'::regclass)
    <> $c$CHECK ((purpose = ANY (ARRAY['CENTRAL_PASSKEY_ENROLLMENT'::text, 'EOC_OIDC_LOGIN'::text, 'EOC_BINDING_APPROVAL'::text, 'EOC_GRANT_APPROVAL'::text])))$c$
 THEN RAISE EXCEPTION 'R645_CHALLENGE_PURPOSES_NOT_AS_630_LEFT_THEM'; END IF;
END $pre$;

-- (a) approver role (assigned to nobody here) ----------------------------------------------------------------------------
INSERT INTO warehouse_identity.roles (role_code, role_name, permissions, active)
VALUES ('IAM_RECOVERY_DESTINATION_APPROVER', 'IAM Recovery Email Approver', ARRAY['warehouse:identity:recovery_destination:approve']::text[], true);

-- (b) tables ---------------------------------------------------------------------------------------------------------------
CREATE TABLE warehouse_identity.recovery_contact_policy_v645 (
  policy_id smallint PRIMARY KEY DEFAULT 1 CHECK (policy_id = 1),
  required_approvals smallint NOT NULL DEFAULT 1 CHECK (required_approvals BETWEEN 1 AND 2),
  eligible_delay_minutes integer NOT NULL DEFAULT 0 CHECK (eligible_delay_minutes BETWEEN 0 AND 10080),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  note text CHECK (note IS NULL OR length(note) <= 300)
);
INSERT INTO warehouse_identity.recovery_contact_policy_v645 (note) VALUES ('2026-11-22: one approver (Anthony) for now; set 2 when a second approver exists');

CREATE TABLE warehouse_identity.recovery_contact_enrollments_v645 (
  enrollment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES warehouse_identity.user_recovery_contacts(contact_id) ON DELETE RESTRICT,
  contact_hint text NOT NULL CHECK (length(contact_hint) BETWEEN 3 AND 120),
  status text NOT NULL DEFAULT 'AWAITING_CODE' CHECK (status IN ('AWAITING_CODE', 'AWAITING_APPROVAL', 'APPROVED', 'CANCELLED', 'EXPIRED')),
  requested_session_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  code_verified_at timestamptz,
  approved_at timestamptz,
  closed_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days'),
  CHECK ((status IN ('AWAITING_APPROVAL', 'APPROVED')) <= (code_verified_at IS NOT NULL)),
  CHECK ((status = 'APPROVED') = (approved_at IS NOT NULL)),
  CHECK ((status IN ('CANCELLED', 'EXPIRED')) = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX recovery_contact_enrollments_v645_one_open ON warehouse_identity.recovery_contact_enrollments_v645 (user_id)
  WHERE status IN ('AWAITING_CODE', 'AWAITING_APPROVAL');
CREATE INDEX recovery_contact_enrollments_v645_contact ON warehouse_identity.recovery_contact_enrollments_v645 (contact_id);
CREATE INDEX recovery_contact_enrollments_v645_recent ON warehouse_identity.recovery_contact_enrollments_v645 (user_id, created_at DESC);

CREATE TABLE warehouse_identity.recovery_contact_approvals_v645 (
  approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES warehouse_identity.recovery_contact_enrollments_v645(enrollment_id) ON DELETE RESTRICT,
  approver_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  web_authn_evidence_id uuid NOT NULL UNIQUE
    REFERENCES warehouse_identity.webauthn_verification_evidence(webauthn_verification_evidence_id) ON DELETE RESTRICT,
  auth_challenge_id uuid NOT NULL UNIQUE,
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (enrollment_id, approver_user_id)
);

DO $rls$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['recovery_contact_policy_v645', 'recovery_contact_enrollments_v645', 'recovery_contact_approvals_v645'] LOOP
  EXECUTE format('ALTER TABLE warehouse_identity.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE warehouse_identity.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL ON warehouse_identity.%I FROM PUBLIC, anon, authenticated, service_role', t);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON warehouse_identity.%I TO tcds_identity_function_owner', t);
 END LOOP;
END $rls$;

-- (c) approval ceremony context (same pattern as 628/630) -----------------------------------------------------------------
ALTER TABLE warehouse_identity.central_challenge_context DROP CONSTRAINT central_challenge_context_purpose_check;
ALTER TABLE warehouse_identity.central_challenge_context ADD CONSTRAINT central_challenge_context_purpose_check
  CHECK (purpose IN ('CENTRAL_PASSKEY_ENROLLMENT', 'EOC_OIDC_LOGIN', 'EOC_BINDING_APPROVAL', 'EOC_GRANT_APPROVAL', 'RECOVERY_CONTACT_APPROVAL'));
ALTER TABLE warehouse_identity.central_challenge_context ADD COLUMN recovery_enrollment_id uuid
  REFERENCES warehouse_identity.recovery_contact_enrollments_v645(enrollment_id);
ALTER TABLE warehouse_identity.central_challenge_context ADD CONSTRAINT central_challenge_context_recovery_check
  CHECK ((purpose = 'RECOVERY_CONTACT_APPROVAL') = (recovery_enrollment_id IS NOT NULL));

-- (d) helpers (no EXECUTE for anyone) -------------------------------------------------------------------------------------
CREATE FUNCTION warehouse_identity.recovery_session_user_v645(p_session uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT s.user_id FROM warehouse_identity.auth_sessions s JOIN warehouse_identity.users u ON u.user_id = s.user_id
   WHERE s.auth_session_id = p_session AND s.revoked_at IS NULL AND s.idle_expires_at > clock_timestamp()
     AND s.absolute_expires_at > clock_timestamp() AND u.status = 'ACTIVE'
$fn$;

CREATE FUNCTION warehouse_identity.recovery_is_contact_approver_v645(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT EXISTS (SELECT 1 FROM warehouse_identity.users u WHERE u.user_id = p_user_id AND u.status = 'ACTIVE') AND EXISTS (
    SELECT 1 FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.roles rol ON rol.role_id = ra.role_id AND rol.active
     WHERE ra.user_id = p_user_id AND ra.revoked_at IS NULL AND ra.valid_from <= clock_timestamp()
       AND (ra.valid_until IS NULL OR ra.valid_until > clock_timestamp()) AND ra.facility_id IS NULL AND ra.station_id IS NULL
       AND 'warehouse:identity:recovery_destination:approve' = ANY (rol.permissions))
$fn$;

-- Close enrollments past their expiry (called by the functions below; idempotent).
CREATE FUNCTION warehouse_identity.recovery_contact_expire_v645(p_user_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  WITH x AS (UPDATE warehouse_identity.recovery_contact_enrollments_v645 e SET status = 'EXPIRED', closed_at = clock_timestamp()
              WHERE e.user_id = p_user_id AND e.status IN ('AWAITING_CODE', 'AWAITING_APPROVAL') AND e.expires_at <= clock_timestamp()
              RETURNING e.contact_id)
  UPDATE warehouse_identity.user_recovery_contacts c SET status = 'REVOKED', revoked_at = clock_timestamp(), updated_at = clock_timestamp(),
         row_version = row_version + 1
    FROM x WHERE c.contact_id = x.contact_id AND c.status = 'PENDING'
$fn$;

-- ===================================================================================== login API (signed-in employee)
-- What the employee's "Recovery email" screen shows. Ciphertext is returned so the API (which holds the key) can mask it.
CREATE FUNCTION warehouse_identity.recovery_contact_overview_v645(p_session uuid)
RETURNS TABLE (kind text, contact_hint text, status text, since timestamptz, expires_at timestamptz, approvals integer, required integer,
  ciphertext bytea, iv bytea, tag bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
#variable_conflict use_column
DECLARE v_user uuid := warehouse_identity.recovery_session_user_v645(p_session);
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = '42501'; END IF;
 PERFORM warehouse_identity.recovery_contact_expire_v645(v_user);
 RETURN QUERY
  SELECT 'ACTIVE'::text, NULL::text, 'VERIFIED'::text, c.verified_at, NULL::timestamptz, NULL::int, NULL::int, c.ciphertext, c.iv, c.tag
    FROM warehouse_identity.user_recovery_contacts c
   WHERE c.user_id = v_user AND c.contact_type = 'EMAIL' AND c.status = 'VERIFIED' AND c.revoked_at IS NULL
  UNION ALL
  SELECT 'PENDING'::text, e.contact_hint, e.status, e.created_at, e.expires_at,
         (SELECT count(*)::int FROM warehouse_identity.recovery_contact_approvals_v645 a WHERE a.enrollment_id = e.enrollment_id),
         (SELECT p.required_approvals::int FROM warehouse_identity.recovery_contact_policy_v645 p), NULL::bytea, NULL::bytea, NULL::bytea
    FROM warehouse_identity.recovery_contact_enrollments_v645 e
   WHERE e.user_id = v_user AND e.status IN ('AWAITING_CODE', 'AWAITING_APPROVAL');
END $fn$;

-- Start: a PENDING contact (new, or the same address re-used), a CONTACT_VERIFY code and its encrypted outbox row.
-- The delivery worker (644 recovery_delivery_claim_v192) sends it exactly like a reset code.
CREATE FUNCTION warehouse_identity.recovery_contact_start_v645(p_session uuid, p_ciphertext bytea, p_iv bytea, p_tag bytea,
  p_fingerprint bytea, p_hint text, p_otp_hash bytea, p_otp_salt bytea, p_payload bytea, p_payload_iv bytea, p_payload_tag bytea,
  p_correlation uuid)
RETURNS TABLE (enrollment_id uuid, delivery_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
#variable_conflict use_column
DECLARE v_user uuid := warehouse_identity.recovery_session_user_v645(p_session); v_contact uuid; v_existing record; v_ch uuid;
  v_enr uuid; v_del uuid := gen_random_uuid(); v_now timestamptz;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = '42501'; END IF;
 IF octet_length(p_iv) <> 12 OR octet_length(p_tag) <> 16 OR p_ciphertext IS NULL OR octet_length(p_fingerprint) <> 32
  OR length(coalesce(p_hint, '')) NOT BETWEEN 3 AND 120 OR octet_length(p_otp_hash) <> 32 OR octet_length(p_otp_salt) <> 16
  OR p_payload IS NULL OR octet_length(p_payload_iv) <> 12 OR octet_length(p_payload_tag) <> 16 OR p_correlation IS NULL
 THEN RAISE EXCEPTION 'RECOVERY_CONTACT_INPUT_INVALID' USING ERRCODE = '22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text, 645));
 PERFORM warehouse_identity.recovery_contact_expire_v645(v_user);
 IF (SELECT count(*) FROM warehouse_identity.recovery_contact_enrollments_v645 e
      WHERE e.user_id = v_user AND e.created_at > clock_timestamp() - interval '24 hours') >= 5
 THEN RAISE EXCEPTION 'RECOVERY_CONTACT_TOO_MANY_ATTEMPTS' USING ERRCODE = '54000'; END IF;
 -- a new start replaces any open enrollment (its pending contact is revoked)
 WITH x AS (UPDATE warehouse_identity.recovery_contact_enrollments_v645 e SET status = 'CANCELLED', closed_at = clock_timestamp()
             WHERE e.user_id = v_user AND e.status IN ('AWAITING_CODE', 'AWAITING_APPROVAL') RETURNING e.contact_id)
 UPDATE warehouse_identity.user_recovery_contacts c SET status = 'REVOKED', revoked_at = clock_timestamp(), updated_at = clock_timestamp(),
        row_version = row_version + 1 FROM x WHERE c.contact_id = x.contact_id AND c.status = 'PENDING';
 SELECT c.contact_id, c.status INTO v_existing FROM warehouse_identity.user_recovery_contacts c
  WHERE c.user_id = v_user AND c.contact_type = 'EMAIL' AND c.value_fingerprint = p_fingerprint;
 IF v_existing.status = 'VERIFIED' THEN RAISE EXCEPTION 'RECOVERY_CONTACT_ALREADY_ACTIVE' USING ERRCODE = '23505'; END IF;
 IF v_existing.contact_id IS NOT NULL THEN
   -- the same address again (vendor unique key includes REVOKED rows): re-open it as PENDING with fresh ciphertext
   UPDATE warehouse_identity.user_recovery_contacts c SET ciphertext = p_ciphertext, iv = p_iv, tag = p_tag, status = 'PENDING',
          verification_method = NULL, verified_at = NULL, revoked_at = NULL, recovery_eligible_at = NULL, updated_at = clock_timestamp(),
          row_version = row_version + 1
    WHERE c.contact_id = v_existing.contact_id;
   v_contact := v_existing.contact_id;
   UPDATE warehouse_identity.recovery_contact_challenges_v1 SET consumed_at = clock_timestamp()
    WHERE contact_id = v_contact AND purpose = 'CONTACT_VERIFY' AND consumed_at IS NULL;
 ELSE
   INSERT INTO warehouse_identity.user_recovery_contacts (user_id, contact_type, ciphertext, iv, tag, value_fingerprint, status)
   VALUES (v_user, 'EMAIL', p_ciphertext, p_iv, p_tag, p_fingerprint, 'PENDING') RETURNING contact_id INTO v_contact;
 END IF;
 INSERT INTO warehouse_identity.recovery_contact_challenges_v1 (user_id, contact_id, purpose, otp_hash, otp_salt, expires_at, delivery_state)
 VALUES (v_user, v_contact, 'CONTACT_VERIFY', p_otp_hash, p_otp_salt, clock_timestamp() + interval '10 minutes', 'PENDING')
 RETURNING recovery_contact_challenges_v1.challenge_id INTO v_ch;          -- 614 trigger sets created_at/expires_at
 v_now := clock_timestamp();
 INSERT INTO warehouse_identity.recovery_secret_outbox_v18 (delivery_id, challenge_id, channel, encrypted_payload, payload_iv, payload_tag,
   correlation_id, created_at, expires_at)
 VALUES (v_del, v_ch, 'EMAIL', p_payload, p_payload_iv, p_payload_tag, p_correlation, v_now,
   least(v_now + interval '10 minutes', (SELECT x.expires_at FROM warehouse_identity.recovery_contact_challenges_v1 x WHERE x.challenge_id = v_ch)));
 v_now := clock_timestamp();
 INSERT INTO warehouse_identity.recovery_contact_enrollments_v645 (user_id, contact_id, contact_hint, requested_session_id, created_at, expires_at)
 VALUES (v_user, v_contact, p_hint, p_session, v_now, v_now + interval '7 days') RETURNING recovery_contact_enrollments_v645.enrollment_id INTO v_enr;
 RETURN QUERY SELECT v_enr, v_del;
END $fn$;

-- Code check, in the caller's transaction: _code_load locks the challenge, the caller compares, _code_settle records it.
CREATE FUNCTION warehouse_identity.recovery_contact_code_load_v645(p_session uuid)
RETURNS TABLE (enrollment_id uuid, challenge_id uuid, otp_hash bytea, otp_salt bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
#variable_conflict use_column
DECLARE v_user uuid := warehouse_identity.recovery_session_user_v645(p_session);
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = '42501'; END IF;
 RETURN QUERY SELECT e.enrollment_id, ch.challenge_id, ch.otp_hash, ch.otp_salt
   FROM warehouse_identity.recovery_contact_enrollments_v645 e
   JOIN warehouse_identity.recovery_contact_challenges_v1 ch ON ch.contact_id = e.contact_id AND ch.user_id = e.user_id
  WHERE e.user_id = v_user AND e.status = 'AWAITING_CODE' AND e.expires_at > clock_timestamp()
    AND ch.purpose = 'CONTACT_VERIFY' AND ch.consumed_at IS NULL AND ch.attempt_count < 5 AND ch.expires_at > clock_timestamp()
    AND ch.delivery_state = 'ACCEPTED'
  ORDER BY ch.created_at DESC LIMIT 1 FOR UPDATE OF ch, e;
 IF NOT FOUND THEN RAISE EXCEPTION 'RECOVERY_CONTACT_CODE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
END $fn$;

-- Returns INVALID (attempt counted) or AWAITING_APPROVAL. Never makes the contact usable by itself.
CREATE FUNCTION warehouse_identity.recovery_contact_code_settle_v645(p_session uuid, p_challenge uuid, p_match boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE v_user uuid := warehouse_identity.recovery_session_user_v645(p_session); v_enr uuid;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = '42501'; END IF;
 IF p_match IS NULL THEN RAISE EXCEPTION 'RECOVERY_CONTACT_INPUT_INVALID' USING ERRCODE = '22023'; END IF;
 SELECT e.enrollment_id INTO v_enr FROM warehouse_identity.recovery_contact_enrollments_v645 e
   JOIN warehouse_identity.recovery_contact_challenges_v1 ch ON ch.contact_id = e.contact_id
  WHERE e.user_id = v_user AND e.status = 'AWAITING_CODE' AND ch.challenge_id = p_challenge AND ch.purpose = 'CONTACT_VERIFY'
    AND ch.consumed_at IS NULL AND ch.attempt_count < 5 AND ch.expires_at > clock_timestamp() AND ch.delivery_state = 'ACCEPTED'
  FOR UPDATE OF e, ch;
 IF v_enr IS NULL THEN RAISE EXCEPTION 'RECOVERY_CONTACT_CODE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 IF NOT p_match THEN
   UPDATE warehouse_identity.recovery_contact_challenges_v1 SET attempt_count = attempt_count + 1 WHERE challenge_id = p_challenge;
   RETURN 'INVALID';
 END IF;
 UPDATE warehouse_identity.recovery_contact_challenges_v1 SET consumed_at = clock_timestamp() WHERE challenge_id = p_challenge;
 UPDATE warehouse_identity.recovery_contact_enrollments_v645 SET status = 'AWAITING_APPROVAL', code_verified_at = clock_timestamp()
  WHERE enrollment_id = v_enr;
 RETURN 'AWAITING_APPROVAL';
END $fn$;

CREATE FUNCTION warehouse_identity.recovery_contact_cancel_v645(p_session uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE v_user uuid := warehouse_identity.recovery_session_user_v645(p_session); v_contact uuid;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = '42501'; END IF;
 UPDATE warehouse_identity.recovery_contact_enrollments_v645 SET status = 'CANCELLED', closed_at = clock_timestamp()
  WHERE user_id = v_user AND status IN ('AWAITING_CODE', 'AWAITING_APPROVAL') RETURNING contact_id INTO v_contact;
 IF v_contact IS NULL THEN RETURN false; END IF;
 UPDATE warehouse_identity.user_recovery_contacts SET status = 'REVOKED', revoked_at = clock_timestamp(), updated_at = clock_timestamp(),
        row_version = row_version + 1 WHERE contact_id = v_contact AND status = 'PENDING';
 RETURN true;
END $fn$;

-- The approval link for one enrollment (the API emails it to the approver). Returns NULL unless it is awaiting approval.
CREATE FUNCTION warehouse_identity.recovery_contact_pending_id_v645(p_session uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT e.enrollment_id FROM warehouse_identity.recovery_contact_enrollments_v645 e
   WHERE e.user_id = warehouse_identity.recovery_session_user_v645(p_session) AND e.status = 'AWAITING_APPROVAL' AND e.expires_at > clock_timestamp()
$fn$;

-- ===================================================================================== verifier (login-stg approval page)
CREATE FUNCTION warehouse_identity.central_recovery_contact_info_v645(p_enrollment_id uuid)
RETURNS TABLE (enrollment_id uuid, status text, target_display_name text, target_username text, employee_number text, contact_hint text,
  requested_at timestamptz, code_verified_at timestamptz, expires_at timestamptz, approvals integer, required integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT e.enrollment_id,
         CASE WHEN e.status IN ('AWAITING_CODE', 'AWAITING_APPROVAL') AND e.expires_at <= clock_timestamp() THEN 'EXPIRED' ELSE e.status END,
         u.display_name::text, u.username::text, (SELECT em.employee_number::text FROM warehouse_identity.employees em WHERE em.user_id = e.user_id LIMIT 1),
         e.contact_hint, e.created_at, e.code_verified_at, e.expires_at,
         (SELECT count(*)::int FROM warehouse_identity.recovery_contact_approvals_v645 a WHERE a.enrollment_id = e.enrollment_id),
         (SELECT p.required_approvals::int FROM warehouse_identity.recovery_contact_policy_v645 p)
    FROM warehouse_identity.recovery_contact_enrollments_v645 e JOIN warehouse_identity.users u ON u.user_id = e.user_id
   WHERE e.enrollment_id = p_enrollment_id
$fn$;

-- Discoverable ceremony: no approver is named; the passkey that signs identifies the approver (checked at finalize).
CREATE FUNCTION warehouse_identity.central_recovery_contact_approval_begin_v645(p_enrollment_id uuid, p_rp_id text, p_origin text,
  p_challenge_hash bytea, p_request uuid, p_correlation uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE e warehouse_identity.recovery_contact_enrollments_v645%ROWTYPE; v_ch uuid; v_now timestamptz := clock_timestamp();
BEGIN
 IF p_challenge_hash IS NULL OR octet_length(p_challenge_hash) <> 32 OR p_origin <> 'https://' || p_rp_id OR p_request IS NULL OR p_correlation IS NULL
 THEN RAISE EXCEPTION 'CENTRAL_APPROVAL_REQUEST_INVALID' USING ERRCODE = '22023'; END IF;
 SELECT * INTO e FROM warehouse_identity.recovery_contact_enrollments_v645 x WHERE x.enrollment_id = p_enrollment_id;
 IF e.enrollment_id IS NULL OR e.status <> 'AWAITING_APPROVAL' OR e.expires_at <= v_now
 THEN RAISE EXCEPTION 'RECOVERY_CONTACT_NOT_AWAITING_APPROVAL' USING ERRCODE = '42501'; END IF;
 INSERT INTO warehouse_identity.auth_challenges (user_id, device_id, ceremony_type, challenge_hash, expected_origin, expected_rp_id,
   request_id, correlation_id, expires_at, result)
 VALUES (NULL, NULL, 'PASSKEY_AUTHENTICATION', p_challenge_hash, p_origin, p_rp_id, p_request, p_correlation, v_now + interval '120 seconds', 'PROCESSING')
 RETURNING auth_challenge_id INTO v_ch;
 INSERT INTO warehouse_identity.central_challenge_context (auth_challenge_id, purpose, rp_id, recovery_enrollment_id)
 VALUES (v_ch, 'RECOVERY_CONTACT_APPROVAL', p_rp_id, p_enrollment_id);
 RETURN v_ch;
END $fn$;

CREATE FUNCTION warehouse_identity.central_finalize_recovery_contact_approval_v645(p_challenge_id uuid, p_claim_hash bytea, p_generation bigint,
  p_central_passkey_id uuid, p_expected_row_version bigint, p_prior_sign_count bigint, p_observed_sign_count bigint,
  p_verified_origin text, p_verified_rp_id text, p_user_verified boolean,
  p_authenticator_data_sha256 text, p_client_data_json_sha256 text, p_signature_sha256 text, p_backup_eligible boolean, p_backed_up boolean,
  p_verifier_service text, p_verifier_version text, p_verifier_instance_id text, p_request_id uuid, p_correlation_id uuid)
RETURNS TABLE (outcome text, approver_user_id uuid, evidence_id uuid, approvals integer, required integer, approved boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
#variable_conflict use_column
DECLARE a warehouse_identity.auth_challenges%ROWTYPE; c warehouse_identity.central_challenge_context%ROWTYPE;
  p warehouse_identity.central_passkeys%ROWTYPE; e warehouse_identity.recovery_contact_enrollments_v645%ROWTYPE;
  v_ev uuid; v_now timestamptz := clock_timestamp(); v_code text; v_n integer; v_req integer; v_delay integer;
BEGIN
 a := warehouse_identity.central_held_claim_v1(p_challenge_id, p_claim_hash, p_generation, 'RECOVERY_CONTACT_APPROVAL');
 IF a.auth_challenge_id IS NULL THEN RETURN QUERY SELECT 'CLAIM_NOT_HELD', NULL::uuid, NULL::uuid, 0, 0, false; RETURN; END IF;
 SELECT * INTO c FROM warehouse_identity.central_challenge_context x WHERE x.auth_challenge_id = a.auth_challenge_id;
 SELECT * INTO e FROM warehouse_identity.recovery_contact_enrollments_v645 x WHERE x.enrollment_id = c.recovery_enrollment_id FOR UPDATE;
 SELECT * INTO p FROM warehouse_identity.central_passkeys x WHERE x.central_passkey_id = p_central_passkey_id AND x.rp_id = a.expected_rp_id FOR UPDATE;
 SELECT x.required_approvals, x.eligible_delay_minutes INTO v_req, v_delay FROM warehouse_identity.recovery_contact_policy_v645 x;
 v_code := CASE
   WHEN a.expected_origin <> p_verified_origin OR a.expected_rp_id <> p_verified_rp_id THEN 'ORIGIN_OR_RP_MISMATCH'
   WHEN p_user_verified IS NOT TRUE THEN 'USER_VERIFICATION_REQUIRED'
   WHEN e.enrollment_id IS NULL OR e.status <> 'AWAITING_APPROVAL' OR e.expires_at <= v_now THEN 'RECOVERY_CONTACT_NOT_AWAITING_APPROVAL'
   WHEN p.central_passkey_id IS NULL OR p.security_state <> 'ACTIVE' THEN 'CREDENTIAL_OR_USER_NOT_ACTIVE'
   WHEN p.row_version <> p_expected_row_version OR p.sign_count <> p_prior_sign_count THEN 'PASSKEY_STATE_CHANGED'
   WHEN p.user_id = e.user_id THEN 'APPROVER_IS_THE_TARGET'
   WHEN NOT warehouse_identity.recovery_is_contact_approver_v645(p.user_id) THEN 'APPROVER_NOT_AUTHORIZED'
   WHEN EXISTS (SELECT 1 FROM warehouse_identity.recovery_contact_approvals_v645 x WHERE x.enrollment_id = e.enrollment_id
                  AND x.approver_user_id = p.user_id) THEN 'APPROVER_ALREADY_APPROVED'
 END;
 IF v_code IS NULL AND (p_observed_sign_count IS NULL OR p_observed_sign_count < 0
     OR ((p_observed_sign_count > 0 OR p.sign_count > 0) AND p_observed_sign_count <= p.sign_count)) THEN
   UPDATE warehouse_identity.central_passkeys SET security_state = 'SUSPENDED', suspended_at = v_now, suspension_reason = 'COUNTER_REGRESSION',
          row_version = row_version + 1 WHERE central_passkey_id = p.central_passkey_id;
   v_code := 'COUNTER_REGRESSION';
 END IF;
 IF v_code IS NOT NULL THEN
   PERFORM warehouse_identity.central_fail_challenge_v1(a.auth_challenge_id, p_claim_hash, v_code);
   RETURN QUERY SELECT v_code, NULL::uuid, NULL::uuid, 0, v_req, false; RETURN;
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
   jsonb_build_object('purpose', 'RECOVERY_CONTACT_APPROVAL', 'centralPasskeyId', p.central_passkey_id,
     'enrollmentId', e.enrollment_id, 'targetUserId', e.user_id, 'contactId', e.contact_id))
 RETURNING webauthn_verification_evidence_id INTO v_ev;
 UPDATE warehouse_identity.auth_challenges SET user_id = p.user_id, consumed_at = v_now, result = 'SUCCEEDED', verified_origin = p_verified_origin,
        verified_rp_id = p_verified_rp_id, user_verification_performed = true, verification_evidence_id = v_ev, credential_id = p.credential_id
  WHERE auth_challenge_id = a.auth_challenge_id;
 INSERT INTO warehouse_identity.recovery_contact_approvals_v645 (enrollment_id, approver_user_id, web_authn_evidence_id, auth_challenge_id, approved_at)
 VALUES (e.enrollment_id, p.user_id, v_ev, a.auth_challenge_id, v_now);
 SELECT count(*)::int INTO v_n FROM warehouse_identity.recovery_contact_approvals_v645 x WHERE x.enrollment_id = e.enrollment_id;
 IF v_n >= v_req THEN
   -- enough approvals: this email becomes the user's recovery email; any other email contact of the user is revoked
   UPDATE warehouse_identity.user_recovery_contacts x SET status = 'REVOKED', revoked_at = v_now, updated_at = v_now, row_version = row_version + 1
    WHERE x.user_id = e.user_id AND x.contact_type = 'EMAIL' AND x.contact_id <> e.contact_id AND x.status IN ('VERIFIED', 'PENDING');
   UPDATE warehouse_identity.user_recovery_contacts x SET status = 'VERIFIED', verification_method = 'EMAIL_CODE', verified_at = v_now,
          recovery_eligible_at = v_now + make_interval(mins => v_delay), revoked_at = NULL, updated_at = v_now, row_version = row_version + 1
    WHERE x.contact_id = e.contact_id;
   UPDATE warehouse_identity.recovery_contact_enrollments_v645 SET status = 'APPROVED', approved_at = v_now WHERE enrollment_id = e.enrollment_id;
   INSERT INTO warehouse_audit.security_events (event_type, severity, actor_user_id, entity_type, entity_id, request_id, correlation_id, details)
   VALUES ('RECOVERY_CONTACT_APPROVED', 50, p.user_id, 'USER_RECOVERY_CONTACT', e.contact_id, p_request_id, p_correlation_id,
     jsonb_build_object('targetUserId', e.user_id, 'enrollmentId', e.enrollment_id, 'approvals', v_n, 'required', v_req));
   RETURN QUERY SELECT 'SUCCEEDED', p.user_id, v_ev, v_n, v_req, true; RETURN;
 END IF;
 RETURN QUERY SELECT 'SUCCEEDED', p.user_id, v_ev, v_n, v_req, false;
END $fn$;

-- (e) ownership + execution ------------------------------------------------------------------------------------------------
-- record the function owner's DIRECT grants first (644 ledger, own prefix) so 645_rollback removes exactly what 645 adds
INSERT INTO warehouse_identity.recovery_v192_ledger (item, value)
SELECT 'v645priv:' || t, coalesce((SELECT string_agg(DISTINCT x.privilege_type, ',') FROM pg_class c, aclexplode(c.relacl) x
  WHERE c.oid = t::regclass AND x.grantee = 'tcds_identity_function_owner'::regrole), '')
FROM unnest(ARRAY['warehouse_identity.user_recovery_contacts', 'warehouse_audit.security_events']) t;
GRANT SELECT, INSERT, UPDATE ON warehouse_identity.user_recovery_contacts TO tcds_identity_function_owner;
GRANT INSERT ON warehouse_audit.security_events TO tcds_identity_function_owner;
DO $own$
DECLARE f regprocedure;
BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'warehouse_identity'::regnamespace
            AND (p.proname LIKE 'recovery\_%\_v645' OR p.proname LIKE 'central\_%\_v645') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  EXECUTE format('ALTER FUNCTION %s OWNER TO tcds_identity_function_owner', f);
 END LOOP;
END $own$;
GRANT EXECUTE ON FUNCTION warehouse_identity.recovery_contact_overview_v645(uuid),
  warehouse_identity.recovery_contact_start_v645(uuid,bytea,bytea,bytea,bytea,text,bytea,bytea,bytea,bytea,bytea,uuid),
  warehouse_identity.recovery_contact_code_load_v645(uuid),
  warehouse_identity.recovery_contact_code_settle_v645(uuid,uuid,boolean),
  warehouse_identity.recovery_contact_cancel_v645(uuid),
  warehouse_identity.recovery_contact_pending_id_v645(uuid) TO tcds_login_api;
GRANT EXECUTE ON FUNCTION warehouse_identity.central_recovery_contact_info_v645(uuid),
  warehouse_identity.central_recovery_contact_approval_begin_v645(uuid,text,text,bytea,uuid,uuid),
  warehouse_identity.central_finalize_recovery_contact_approval_v645(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid)
  TO tcds_identity_central_verifier;

DO $verify$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_proc p WHERE p.pronamespace = 'warehouse_identity'::regnamespace
   AND (p.proname LIKE 'recovery\_%\_v645' OR p.proname LIKE 'central\_%\_v645')
   AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'tcds_identity_function_owner'
   AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('public', p.oid, 'EXECUTE');
 IF n <> 12 THEN RAISE EXCEPTION 'R645_EXPECTED_12_SECURE_FUNCTIONS_GOT_%', n; END IF;
 IF has_function_privilege('tcds_login_api', 'warehouse_identity.central_finalize_recovery_contact_approval_v645(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid)', 'EXECUTE')
 THEN RAISE EXCEPTION 'R645_LOGIN_API_CAN_APPROVE'; END IF;
 IF has_function_privilege('tcds_identity_central_verifier', 'warehouse_identity.recovery_contact_start_v645(uuid,bytea,bytea,bytea,bytea,text,bytea,bytea,bytea,bytea,bytea,uuid)', 'EXECUTE')
 THEN RAISE EXCEPTION 'R645_VERIFIER_CAN_ENROLL'; END IF;
END $verify$;
COMMIT;
