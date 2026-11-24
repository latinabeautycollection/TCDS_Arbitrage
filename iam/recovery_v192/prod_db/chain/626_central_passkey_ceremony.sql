-- 626 - ours (TCDS production engineering). STAGING FIRST. Central laptop passkey ceremony for the OIDC issuer
-- (EOC_OIDC_LOGIN), approved by the dev team 2026-11-18: RP ID login-stg.tcdsolutionsgroup.com (production
-- login.tcdsolutionsgroup.com), laptop/browser, issuer-bound, user-verified, single-use, independent of Warehouse
-- facility/device enrollment.
--
-- Warehouse authentication is not changed: no Warehouse table, function, grant or row is altered. New:
--   central_passkeys            passkeys registered for the central issuer RP (own rp_id; no device)
--   central_enrollment_invites  single-use enrollment invite for ONE named user (token stored only as a hash)
--   central_challenge_context   purpose / issuer / interaction / invite of each central challenge
--   central_workload_nonces     replay guard for the 6.1C central workload scope (own secret, own scope)
-- Central challenges and evidence are rows in the EXISTING warehouse_identity.auth_challenges (device_id NULL,
-- expected_rp_id = the central RP) and webauthn_verification_evidence (passkey_id NULL, central passkey id in
-- details), so all WebAuthn evidence stays in the one table 624 and the auditors read.
-- Functions are SECURITY DEFINER, owned by tcds_identity_function_owner, search_path pg_catalog:
--   tcds_identity_central_verifier  (6.1C central routes): workload nonce, enrollment begin/finalize, login
--                                   begin/finalize, claim, fail, passkey material
--   tcds_identity_central_admin     (pilot admin script): issue invite, revoke passkey
-- No table grants to either role. Each challenge is claimed once, by one verifier, then consumed.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
 IF to_regclass('warehouse_identity.auth_challenges') IS NULL OR to_regclass('warehouse_identity.webauthn_verification_evidence') IS NULL
 OR to_regclass('warehouse_identity.users') IS NULL THEN RAISE EXCEPTION 'R626_WEBAUTHN_TABLES_MISSING'; END IF;
 IF to_regclass('warehouse_identity.central_passkeys') IS NOT NULL OR to_regclass('warehouse_identity.central_enrollment_invites') IS NOT NULL
 OR to_regclass('warehouse_identity.central_challenge_context') IS NOT NULL OR to_regclass('warehouse_identity.central_workload_nonces') IS NOT NULL
 THEN RAISE EXCEPTION 'R626_ALREADY_INSTALLED'; END IF;
 -- the shared columns this migration writes must be exactly what the inspect showed (device and user nullable)
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'warehouse_identity.auth_challenges'::regclass AND NOT attisdropped
       AND ((attname IN ('user_id', 'device_id') AND NOT attnotnull)
         OR attname IN ('verification_claim_token_hash', 'verification_claim_expires_at', 'verification_claim_generation',
                        'verified_origin', 'verified_rp_id', 'user_verification_performed', 'verification_evidence_id', 'credential_id'))) <> 10
 THEN RAISE EXCEPTION 'R626_AUTH_CHALLENGES_SHAPE_UNEXPECTED'; END IF;
 IF NOT (has_table_privilege('tcds_identity_function_owner', 'warehouse_identity.auth_challenges', 'SELECT,INSERT,UPDATE')
     AND has_table_privilege('tcds_identity_function_owner', 'warehouse_identity.webauthn_verification_evidence', 'SELECT,INSERT')
     AND has_table_privilege('tcds_identity_function_owner', 'warehouse_identity.users', 'SELECT'))
 THEN RAISE EXCEPTION 'R626_FUNCTION_OWNER_LACKS_SHARED_TABLE_ACCESS'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('tcds_identity_central_verifier', 'tcds_identity_central_admin'))
 THEN RAISE EXCEPTION 'R626_ROLES_ALREADY_EXIST'; END IF;
END $pre$;

-- Temporarily let the migrator act as the function owner (as 620-623); restored below.
CREATE TEMP TABLE r626_m ON COMMIT DROP AS
SELECT NOT pg_has_role(current_user, 'tcds_identity_function_owner', 'USAGE') OR NOT pg_has_role(current_user, 'tcds_identity_function_owner', 'SET') AS need,
       (SELECT inherit_option FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS m_inherit,
       (SELECT set_option FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS m_set,
       EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS had,
       has_schema_privilege('tcds_identity_function_owner', 'warehouse_identity', 'CREATE') AS had_create;
DO $up$ BEGIN
 IF (SELECT need FROM r626_m) THEN EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT TRUE, SET TRUE', current_user); END IF;
 IF NOT (SELECT had_create FROM r626_m) THEN EXECUTE 'GRANT CREATE ON SCHEMA warehouse_identity TO tcds_identity_function_owner'; END IF;
END $up$;

CREATE ROLE tcds_identity_central_verifier NOLOGIN;
CREATE ROLE tcds_identity_central_admin NOLOGIN;
GRANT USAGE ON SCHEMA warehouse_identity TO tcds_identity_central_verifier, tcds_identity_central_admin;

-- (a) tables --------------------------------------------------------------------------------------------------------
CREATE TABLE warehouse_identity.central_enrollment_invites (
  central_enrollment_invite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  rp_id text NOT NULL CHECK (rp_id ~ '^[a-z0-9.-]{3,253}$'),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  issued_by uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  user_handle bytea CHECK (user_handle IS NULL OR octet_length(user_handle) = 32),
  begin_count integer NOT NULL DEFAULT 0 CHECK (begin_count BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_passkey_id uuid,
  revoked_at timestamptz,
  request_id uuid NOT NULL,
  CHECK (issued_by <> user_id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '72 hours'),
  CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);
CREATE UNIQUE INDEX central_enrollment_invites_one_open ON warehouse_identity.central_enrollment_invites (user_id, rp_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE warehouse_identity.central_passkeys (
  central_passkey_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  rp_id text NOT NULL CHECK (rp_id ~ '^[a-z0-9.-]{3,253}$'),
  credential_id text NOT NULL UNIQUE CHECK (credential_id ~ '^[A-Za-z0-9_-]+$' AND length(credential_id) BETWEEN 16 AND 1366),
  user_handle bytea NOT NULL CHECK (octet_length(user_handle) = 32),
  public_key bytea NOT NULL,
  public_key_algorithm integer NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports text[] NOT NULL DEFAULT ARRAY[]::text[],
  aaguid uuid,
  credential_device_type text,
  backup_eligible boolean NOT NULL,
  backed_up boolean NOT NULL,
  friendly_name text CHECK (friendly_name IS NULL OR length(friendly_name) <= 100),
  security_state text NOT NULL DEFAULT 'ACTIVE' CHECK (security_state IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  enrollment_invite_id uuid NOT NULL UNIQUE REFERENCES warehouse_identity.central_enrollment_invites(central_enrollment_invite_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_used_at timestamptz,
  suspended_at timestamptz,
  suspension_reason text,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  revocation_reason text,
  row_version bigint NOT NULL DEFAULT 1,
  CHECK ((security_state = 'REVOKED') = (revoked_at IS NOT NULL)),
  CHECK (revoked_at IS NULL OR revoked_by IS NOT NULL)
);
CREATE INDEX central_passkeys_user ON warehouse_identity.central_passkeys (user_id, rp_id);

CREATE TABLE warehouse_identity.central_challenge_context (
  auth_challenge_id uuid PRIMARY KEY REFERENCES warehouse_identity.auth_challenges(auth_challenge_id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('CENTRAL_PASSKEY_ENROLLMENT', 'EOC_OIDC_LOGIN')),
  rp_id text NOT NULL,
  issuer text CHECK (issuer IS NULL OR issuer ~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?/?$'),
  interaction_id text CHECK (interaction_id IS NULL OR interaction_id ~ '^[A-Za-z0-9_-]{8,160}$'),
  issuer_request_id uuid,
  enrollment_invite_id uuid REFERENCES warehouse_identity.central_enrollment_invites(central_enrollment_invite_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((purpose = 'EOC_OIDC_LOGIN') = (issuer IS NOT NULL AND interaction_id IS NOT NULL AND issuer_request_id IS NOT NULL)),
  CHECK ((purpose = 'CENTRAL_PASSKEY_ENROLLMENT') = (enrollment_invite_id IS NOT NULL))
);
CREATE UNIQUE INDEX central_challenge_context_issuer_request ON warehouse_identity.central_challenge_context (issuer, interaction_id, issuer_request_id)
  WHERE purpose = 'EOC_OIDC_LOGIN';

CREATE TABLE warehouse_identity.central_workload_nonces (
  nonce_hash bytea PRIMARY KEY CHECK (octet_length(nonce_hash) = 32),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX central_workload_nonces_expiry ON warehouse_identity.central_workload_nonces (expires_at);
ALTER TABLE warehouse_identity.central_workload_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.central_workload_nonces FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.central_workload_nonces FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON warehouse_identity.central_workload_nonces TO tcds_identity_function_owner;

ALTER TABLE warehouse_identity.central_enrollment_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.central_enrollment_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.central_passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.central_passkeys FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.central_challenge_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.central_challenge_context FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.central_enrollment_invites, warehouse_identity.central_passkeys,
  warehouse_identity.central_challenge_context FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON warehouse_identity.central_enrollment_invites, warehouse_identity.central_passkeys,
  warehouse_identity.central_challenge_context TO tcds_identity_function_owner;

-- (b) helpers -------------------------------------------------------------------------------------------------------
CREATE FUNCTION warehouse_identity.central_user_active_v1(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT EXISTS (SELECT 1 FROM warehouse_identity.users u WHERE u.user_id = p_user_id AND u.status = 'ACTIVE' AND u.archived_at IS NULL)
$fn$;

-- One use per workload nonce; expired nonces are pruned on each admission.
CREATE FUNCTION warehouse_identity.central_claim_workload_nonce_v1(p_nonce_hash bytea, p_request_id uuid, p_correlation_id uuid,
  p_expires_at timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
 IF p_nonce_hash IS NULL OR octet_length(p_nonce_hash) <> 32 OR p_request_id IS NULL OR p_correlation_id IS NULL
  OR p_expires_at <= clock_timestamp() OR p_expires_at > clock_timestamp() + interval '120 seconds' THEN RETURN false; END IF;
 DELETE FROM warehouse_identity.central_workload_nonces WHERE expires_at < clock_timestamp();
 INSERT INTO warehouse_identity.central_workload_nonces (nonce_hash, request_id, correlation_id, expires_at)
 VALUES (p_nonce_hash, p_request_id, p_correlation_id, p_expires_at) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $fn$;

-- (c) admin: invites and revocation ---------------------------------------------------------------------------------
-- One open invite per user and RP: a new invite revokes the previous open one.
CREATE FUNCTION warehouse_identity.central_issue_invite_v1(p_user_id uuid, p_issued_by uuid, p_token_hash bytea, p_rp_id text,
  p_ttl_minutes integer, p_reason text, p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE v uuid; v_now timestamptz := clock_timestamp();
BEGIN
 IF p_user_id IS NULL OR p_issued_by IS NULL OR p_user_id = p_issued_by OR p_request_id IS NULL
  OR p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 OR p_rp_id !~ '^[a-z0-9.-]{3,253}$'
  OR p_ttl_minutes IS NULL OR p_ttl_minutes NOT BETWEEN 5 AND 4320 OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500
 THEN RAISE EXCEPTION 'CENTRAL_INVITE_REQUEST_INVALID' USING ERRCODE = '22023'; END IF;
 IF NOT warehouse_identity.central_user_active_v1(p_user_id) THEN RAISE EXCEPTION 'CENTRAL_INVITE_USER_NOT_ACTIVE' USING ERRCODE = '42501'; END IF;
 IF NOT warehouse_identity.central_user_active_v1(p_issued_by) THEN RAISE EXCEPTION 'CENTRAL_INVITE_ISSUER_NOT_ACTIVE' USING ERRCODE = '42501'; END IF;
 UPDATE warehouse_identity.central_enrollment_invites SET revoked_at = v_now
  WHERE user_id = p_user_id AND rp_id = p_rp_id AND consumed_at IS NULL AND revoked_at IS NULL;
 INSERT INTO warehouse_identity.central_enrollment_invites (user_id, rp_id, token_hash, issued_by, reason, expires_at, request_id)
 VALUES (p_user_id, p_rp_id, p_token_hash, p_issued_by, btrim(p_reason), v_now + make_interval(mins => p_ttl_minutes), p_request_id)
 RETURNING central_enrollment_invite_id INTO v;
 RETURN v;
END $fn$;

CREATE FUNCTION warehouse_identity.central_revoke_passkey_v1(p_central_passkey_id uuid, p_revoked_by uuid, p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
 IF p_revoked_by IS NULL OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'CENTRAL_REVOKE_REQUEST_INVALID' USING ERRCODE = '22023'; END IF;
 UPDATE warehouse_identity.central_passkeys SET security_state = 'REVOKED', revoked_at = clock_timestamp(), revoked_by = p_revoked_by,
        revocation_reason = btrim(p_reason), row_version = row_version + 1
  WHERE central_passkey_id = p_central_passkey_id AND revoked_at IS NULL;
 RETURN FOUND;
END $fn$;

-- (d) verifier: challenges ------------------------------------------------------------------------------------------
CREATE FUNCTION warehouse_identity.central_enrollment_begin_v1(p_token_hash bytea, p_rp_id text, p_origin text, p_challenge_hash bytea,
  p_request_id uuid, p_correlation_id uuid)
RETURNS TABLE (auth_challenge_id uuid, user_id uuid, username text, display_name text, user_handle bytea, exclude_credential_ids text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE i warehouse_identity.central_enrollment_invites%ROWTYPE; u record; v_handle bytea; v_ch uuid; v_now timestamptz := clock_timestamp();
BEGIN
 IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 OR p_challenge_hash IS NULL OR octet_length(p_challenge_hash) <> 32
  OR p_origin <> 'https://' || p_rp_id OR p_request_id IS NULL OR p_correlation_id IS NULL
 THEN RAISE EXCEPTION 'CENTRAL_ENROLLMENT_REQUEST_INVALID' USING ERRCODE = '22023'; END IF;
 SELECT * INTO i FROM warehouse_identity.central_enrollment_invites x WHERE x.token_hash = p_token_hash FOR UPDATE;
 IF NOT FOUND OR i.rp_id <> p_rp_id OR i.consumed_at IS NOT NULL OR i.revoked_at IS NOT NULL OR i.expires_at <= v_now OR i.begin_count >= 10
 THEN RAISE EXCEPTION 'CENTRAL_INVITE_INVALID' USING ERRCODE = '42501'; END IF;
 SELECT x.user_id, x.username, x.display_name INTO u FROM warehouse_identity.users x
  WHERE x.user_id = i.user_id AND x.status = 'ACTIVE' AND x.archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'CENTRAL_INVITE_USER_NOT_ACTIVE' USING ERRCODE = '42501'; END IF;
 -- one stable WebAuthn user handle per user and RP
 SELECT p.user_handle INTO v_handle FROM warehouse_identity.central_passkeys p WHERE p.user_id = i.user_id AND p.rp_id = i.rp_id LIMIT 1;
 v_handle := coalesce(v_handle, i.user_handle, uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()));
 UPDATE warehouse_identity.central_enrollment_invites x SET user_handle = v_handle, begin_count = x.begin_count + 1
  WHERE x.central_enrollment_invite_id = i.central_enrollment_invite_id;
 INSERT INTO warehouse_identity.auth_challenges (user_id, device_id, ceremony_type, challenge_hash, expected_origin, expected_rp_id,
   request_id, correlation_id, expires_at, result)
 VALUES (i.user_id, NULL, 'PASSKEY_REGISTRATION', p_challenge_hash, p_origin, p_rp_id, p_request_id, p_correlation_id,
   v_now + interval '5 minutes', 'PROCESSING')
 RETURNING warehouse_identity.auth_challenges.auth_challenge_id INTO v_ch;
 INSERT INTO warehouse_identity.central_challenge_context (auth_challenge_id, purpose, rp_id, enrollment_invite_id)
 VALUES (v_ch, 'CENTRAL_PASSKEY_ENROLLMENT', p_rp_id, i.central_enrollment_invite_id);
 RETURN QUERY SELECT v_ch, u.user_id, u.username::text, u.display_name::text, v_handle,
   coalesce((SELECT array_agg(p.credential_id ORDER BY p.created_at) FROM warehouse_identity.central_passkeys p
              WHERE p.user_id = i.user_id AND p.rp_id = i.rp_id AND p.revoked_at IS NULL), ARRAY[]::text[]);
END $fn$;

-- Discoverable login: no user until the asserted credential is verified.
CREATE FUNCTION warehouse_identity.central_login_begin_v1(p_issuer text, p_interaction_id text, p_issuer_request_id uuid, p_rp_id text,
  p_origin text, p_challenge_hash bytea, p_request_id uuid, p_correlation_id uuid, p_ttl_seconds integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE v_ch uuid; v_now timestamptz := clock_timestamp();
BEGIN
 IF p_issuer !~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?/?$' OR p_interaction_id !~ '^[A-Za-z0-9_-]{8,160}$' OR p_issuer_request_id IS NULL
  OR p_challenge_hash IS NULL OR octet_length(p_challenge_hash) <> 32 OR p_origin <> 'https://' || p_rp_id
  OR p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 30 AND 120 OR p_request_id IS NULL OR p_correlation_id IS NULL
 THEN RAISE EXCEPTION 'CENTRAL_LOGIN_REQUEST_INVALID' USING ERRCODE = '22023'; END IF;
 -- at most one live challenge per issuer interaction
 IF EXISTS (SELECT 1 FROM warehouse_identity.central_challenge_context c JOIN warehouse_identity.auth_challenges a USING (auth_challenge_id)
             WHERE c.purpose = 'EOC_OIDC_LOGIN' AND c.issuer = p_issuer AND c.interaction_id = p_interaction_id
               AND a.consumed_at IS NULL AND a.expires_at > v_now)
 THEN RAISE EXCEPTION 'CENTRAL_LOGIN_ALREADY_STARTED' USING ERRCODE = '42501'; END IF;
 INSERT INTO warehouse_identity.auth_challenges (user_id, device_id, ceremony_type, challenge_hash, expected_origin, expected_rp_id,
   request_id, correlation_id, expires_at, result)
 VALUES (NULL, NULL, 'PASSKEY_AUTHENTICATION', p_challenge_hash, p_origin, p_rp_id, p_request_id, p_correlation_id,
   v_now + make_interval(secs => p_ttl_seconds), 'PROCESSING')
 RETURNING auth_challenge_id INTO v_ch;
 INSERT INTO warehouse_identity.central_challenge_context (auth_challenge_id, purpose, rp_id, issuer, interaction_id, issuer_request_id)
 VALUES (v_ch, 'EOC_OIDC_LOGIN', p_rp_id, p_issuer, p_interaction_id, p_issuer_request_id);
 RETURN v_ch;
END $fn$;

-- One verifier claims a challenge before verifying it. Failures are counted and persist (no exception), so a
-- guessing loop locks the challenge after 5 attempts.
-- For a login, the claim must name the same issuer, interaction and issuer request the challenge was issued for.
CREATE FUNCTION warehouse_identity.central_claim_challenge_v1(p_challenge_id uuid, p_challenge_hash bytea, p_claim_hash bytea,
  p_purpose text, p_rp_id text, p_issuer text, p_interaction_id text, p_issuer_request_id uuid) RETURNS TABLE (outcome text, claim_generation bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE a warehouse_identity.auth_challenges%ROWTYPE; c warehouse_identity.central_challenge_context%ROWTYPE; v_now timestamptz := clock_timestamp();
BEGIN
 IF p_claim_hash IS NULL OR octet_length(p_claim_hash) <> 32 THEN RETURN QUERY SELECT 'CLAIM_INVALID', NULL::bigint; RETURN; END IF;
 SELECT * INTO a FROM warehouse_identity.auth_challenges x WHERE x.auth_challenge_id = p_challenge_id FOR UPDATE;
 SELECT * INTO c FROM warehouse_identity.central_challenge_context x WHERE x.auth_challenge_id = p_challenge_id;
 IF a.auth_challenge_id IS NULL OR c.auth_challenge_id IS NULL THEN RETURN QUERY SELECT 'CHALLENGE_NOT_FOUND', NULL::bigint; RETURN; END IF;
 IF c.purpose <> p_purpose OR c.rp_id <> p_rp_id OR a.expected_rp_id <> p_rp_id THEN RETURN QUERY SELECT 'PURPOSE_OR_RP_MISMATCH', NULL::bigint; RETURN; END IF;
 IF c.purpose = 'EOC_OIDC_LOGIN' AND (c.issuer IS DISTINCT FROM p_issuer OR c.interaction_id IS DISTINCT FROM p_interaction_id
     OR c.issuer_request_id IS DISTINCT FROM p_issuer_request_id) THEN RETURN QUERY SELECT 'ISSUER_BINDING_MISMATCH', NULL::bigint; RETURN; END IF;
 IF a.consumed_at IS NOT NULL OR a.locked_at IS NOT NULL THEN RETURN QUERY SELECT 'CHALLENGE_CONSUMED', NULL::bigint; RETURN; END IF;
 IF a.expires_at <= v_now THEN
   UPDATE warehouse_identity.auth_challenges SET consumed_at = v_now, result = 'EXPIRED', failure_code = 'EXPIRED' WHERE auth_challenge_id = a.auth_challenge_id;
   RETURN QUERY SELECT 'CHALLENGE_EXPIRED', NULL::bigint; RETURN;
 END IF;
 IF a.verification_claim_token_hash IS NOT NULL AND a.verification_claim_expires_at > v_now THEN
   RETURN QUERY SELECT 'CHALLENGE_ALREADY_CLAIMED', NULL::bigint; RETURN;
 END IF;
 IF a.challenge_hash <> p_challenge_hash THEN
   UPDATE warehouse_identity.auth_challenges SET attempts = least(attempts + 1, 5),
          locked_at = CASE WHEN attempts + 1 >= 5 THEN v_now END,
          consumed_at = CASE WHEN attempts + 1 >= 5 THEN v_now END,
          result = CASE WHEN attempts + 1 >= 5 THEN 'FAILED' ELSE result END,
          failure_code = CASE WHEN attempts + 1 >= 5 THEN 'TOO_MANY_ATTEMPTS' ELSE failure_code END
    WHERE auth_challenge_id = a.auth_challenge_id;
   RETURN QUERY SELECT 'CHALLENGE_MISMATCH', NULL::bigint; RETURN;
 END IF;
 UPDATE warehouse_identity.auth_challenges SET verification_claim_token_hash = p_claim_hash, verification_claimed_at = v_now,
        verification_claim_expires_at = v_now + interval '60 seconds',
        verification_claim_generation = verification_claim_generation + 1, attempts = least(attempts + 1, 5)
  WHERE auth_challenge_id = a.auth_challenge_id;
 RETURN QUERY SELECT 'CLAIMED', a.verification_claim_generation + 1;
END $fn$;

-- Internal: the claim must be the current one. Returns the locked challenge row, or NULL.
CREATE FUNCTION warehouse_identity.central_held_claim_v1(p_challenge_id uuid, p_claim_hash bytea, p_generation bigint, p_purpose text)
RETURNS warehouse_identity.auth_challenges
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE a warehouse_identity.auth_challenges%ROWTYPE;
BEGIN
 SELECT x.* INTO a FROM warehouse_identity.auth_challenges x JOIN warehouse_identity.central_challenge_context c USING (auth_challenge_id)
  WHERE x.auth_challenge_id = p_challenge_id AND c.purpose = p_purpose FOR UPDATE OF x;
 IF a.auth_challenge_id IS NULL OR a.consumed_at IS NOT NULL OR a.verification_claim_token_hash IS DISTINCT FROM p_claim_hash
  OR a.verification_claim_generation IS DISTINCT FROM p_generation OR a.verification_claim_expires_at <= clock_timestamp()
  OR a.expires_at <= clock_timestamp() - interval '60 seconds' THEN RETURN NULL; END IF;
 RETURN a;
END $fn$;

CREATE FUNCTION warehouse_identity.central_fail_challenge_v1(p_challenge_id uuid, p_claim_hash bytea, p_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
 UPDATE warehouse_identity.auth_challenges a SET consumed_at = clock_timestamp(), result = 'FAILED',
        failure_code = left(coalesce(nullif(regexp_replace(p_code, '[^A-Z0-9_]', '', 'g'), ''), 'VERIFICATION_FAILED'), 120)
  WHERE a.auth_challenge_id = p_challenge_id AND a.consumed_at IS NULL AND a.verification_claim_token_hash = p_claim_hash
    AND EXISTS (SELECT 1 FROM warehouse_identity.central_challenge_context c WHERE c.auth_challenge_id = a.auth_challenge_id);
 RETURN FOUND;
END $fn$;

CREATE FUNCTION warehouse_identity.central_passkey_material_v1(p_credential_id text, p_rp_id text)
RETURNS TABLE (central_passkey_id uuid, user_id uuid, credential_id text, public_key bytea, public_key_algorithm integer, sign_count bigint,
  transports text[], user_handle bytea, security_state text, row_version bigint, user_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT p.central_passkey_id, p.user_id, p.credential_id, p.public_key, p.public_key_algorithm, p.sign_count, p.transports, p.user_handle,
         p.security_state, p.row_version, warehouse_identity.central_user_active_v1(p.user_id)
    FROM warehouse_identity.central_passkeys p WHERE p.credential_id = p_credential_id AND p.rp_id = p_rp_id
$fn$;

-- (e) verifier: finalize ---------------------------------------------------------------------------------------------
CREATE FUNCTION warehouse_identity.central_finalize_enrollment_v1(p_challenge_id uuid, p_claim_hash bytea, p_generation bigint,
  p_credential_id text, p_public_key bytea, p_public_key_algorithm integer, p_transports text[], p_aaguid uuid, p_device_type text,
  p_backup_eligible boolean, p_backed_up boolean, p_friendly_name text, p_verified_origin text, p_verified_rp_id text, p_user_verified boolean,
  p_authenticator_data_sha256 text, p_client_data_json_sha256 text, p_public_key_sha256 text,
  p_verifier_service text, p_verifier_version text, p_verifier_instance_id text, p_request_id uuid, p_correlation_id uuid)
RETURNS TABLE (outcome text, central_passkey_id uuid, evidence_id uuid, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE a warehouse_identity.auth_challenges%ROWTYPE; c warehouse_identity.central_challenge_context%ROWTYPE;
  i warehouse_identity.central_enrollment_invites%ROWTYPE; v_pk uuid; v_ev uuid; v_now timestamptz := clock_timestamp();
BEGIN
 a := warehouse_identity.central_held_claim_v1(p_challenge_id, p_claim_hash, p_generation, 'CENTRAL_PASSKEY_ENROLLMENT');
 IF a.auth_challenge_id IS NULL THEN RETURN QUERY SELECT 'CLAIM_NOT_HELD', NULL::uuid, NULL::uuid, NULL::uuid; RETURN; END IF;
 SELECT * INTO c FROM warehouse_identity.central_challenge_context x WHERE x.auth_challenge_id = a.auth_challenge_id;
 IF a.expected_origin <> p_verified_origin OR a.expected_rp_id <> p_verified_rp_id OR p_user_verified IS NOT TRUE
  OR p_credential_id IS NULL OR p_credential_id !~ '^[A-Za-z0-9_-]+$' OR length(p_credential_id) NOT BETWEEN 16 AND 1366 OR p_public_key IS NULL OR p_public_key_algorithm IS NULL THEN
   PERFORM warehouse_identity.central_fail_challenge_v1(a.auth_challenge_id, p_claim_hash, 'ENROLLMENT_EVIDENCE_INVALID');
   RETURN QUERY SELECT 'ENROLLMENT_EVIDENCE_INVALID', NULL::uuid, NULL::uuid, NULL::uuid; RETURN;
 END IF;
 SELECT * INTO i FROM warehouse_identity.central_enrollment_invites x WHERE x.central_enrollment_invite_id = c.enrollment_invite_id FOR UPDATE;
 IF i.consumed_at IS NOT NULL OR i.revoked_at IS NOT NULL OR i.expires_at <= v_now OR i.user_id <> a.user_id
  OR NOT warehouse_identity.central_user_active_v1(i.user_id) THEN
   PERFORM warehouse_identity.central_fail_challenge_v1(a.auth_challenge_id, p_claim_hash, 'INVITE_NO_LONGER_VALID');
   RETURN QUERY SELECT 'INVITE_NO_LONGER_VALID', NULL::uuid, NULL::uuid, NULL::uuid; RETURN;
 END IF;
 IF EXISTS (SELECT 1 FROM warehouse_identity.central_passkeys p WHERE p.credential_id = p_credential_id) THEN
   PERFORM warehouse_identity.central_fail_challenge_v1(a.auth_challenge_id, p_claim_hash, 'CREDENTIAL_ALREADY_REGISTERED');
   RETURN QUERY SELECT 'CREDENTIAL_ALREADY_REGISTERED', NULL::uuid, NULL::uuid, NULL::uuid; RETURN;
 END IF;
 INSERT INTO warehouse_identity.central_passkeys (user_id, rp_id, credential_id, user_handle, public_key, public_key_algorithm, transports,
   aaguid, credential_device_type, backup_eligible, backed_up, friendly_name, enrollment_invite_id)
 VALUES (i.user_id, i.rp_id, p_credential_id, i.user_handle, p_public_key, p_public_key_algorithm, coalesce(p_transports, ARRAY[]::text[]),
   p_aaguid, p_device_type, coalesce(p_backup_eligible, false), coalesce(p_backed_up, false), left(p_friendly_name, 100), i.central_enrollment_invite_id)
 RETURNING warehouse_identity.central_passkeys.central_passkey_id INTO v_pk;
 INSERT INTO warehouse_identity.webauthn_verification_evidence (auth_challenge_id, ceremony_type, user_id, passkey_id, credential_id,
   verified_origin, verified_rp_id, user_verified, authenticator_data_sha256, client_data_json_sha256, public_key_sha256,
   backup_eligible, backed_up, aaguid, verifier_service, verifier_version, verifier_instance_id, request_id, correlation_id, details)
 VALUES (a.auth_challenge_id, 'PASSKEY_REGISTRATION', i.user_id, NULL, p_credential_id, p_verified_origin, p_verified_rp_id, true,
   p_authenticator_data_sha256, p_client_data_json_sha256, p_public_key_sha256, p_backup_eligible, p_backed_up, p_aaguid,
   p_verifier_service, p_verifier_version, p_verifier_instance_id, p_request_id, p_correlation_id,
   jsonb_build_object('purpose', 'CENTRAL_PASSKEY_ENROLLMENT', 'centralPasskeyId', v_pk, 'enrollmentInviteId', i.central_enrollment_invite_id))
 RETURNING webauthn_verification_evidence_id INTO v_ev;
 UPDATE warehouse_identity.auth_challenges SET consumed_at = v_now, result = 'SUCCEEDED', verified_origin = p_verified_origin,
        verified_rp_id = p_verified_rp_id, user_verification_performed = true, verification_evidence_id = v_ev, credential_id = p_credential_id
  WHERE auth_challenge_id = a.auth_challenge_id;
 UPDATE warehouse_identity.central_enrollment_invites SET consumed_at = v_now, consumed_passkey_id = v_pk
  WHERE central_enrollment_invite_id = i.central_enrollment_invite_id;
 RETURN QUERY SELECT 'SUCCEEDED', v_pk, v_ev, i.user_id;
END $fn$;

CREATE FUNCTION warehouse_identity.central_finalize_login_v1(p_challenge_id uuid, p_claim_hash bytea, p_generation bigint,
  p_central_passkey_id uuid, p_expected_row_version bigint, p_prior_sign_count bigint, p_observed_sign_count bigint,
  p_verified_origin text, p_verified_rp_id text, p_user_verified boolean,
  p_authenticator_data_sha256 text, p_client_data_json_sha256 text, p_signature_sha256 text, p_backup_eligible boolean, p_backed_up boolean,
  p_verifier_service text, p_verifier_version text, p_verifier_instance_id text, p_request_id uuid, p_correlation_id uuid)
RETURNS TABLE (outcome text, user_id uuid, evidence_id uuid, auth_time timestamptz, issuer text, interaction_id text, issuer_request_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE a warehouse_identity.auth_challenges%ROWTYPE; c warehouse_identity.central_challenge_context%ROWTYPE;
  p warehouse_identity.central_passkeys%ROWTYPE; v_ev uuid; v_now timestamptz := clock_timestamp();
BEGIN
 a := warehouse_identity.central_held_claim_v1(p_challenge_id, p_claim_hash, p_generation, 'EOC_OIDC_LOGIN');
 IF a.auth_challenge_id IS NULL THEN RETURN QUERY SELECT 'CLAIM_NOT_HELD', NULL::uuid, NULL::uuid, NULL::timestamptz, NULL, NULL, NULL::uuid; RETURN; END IF;
 SELECT * INTO c FROM warehouse_identity.central_challenge_context x WHERE x.auth_challenge_id = a.auth_challenge_id;
 IF a.expected_origin <> p_verified_origin OR a.expected_rp_id <> p_verified_rp_id THEN
   PERFORM warehouse_identity.central_fail_challenge_v1(a.auth_challenge_id, p_claim_hash, 'ORIGIN_OR_RP_MISMATCH');
   RETURN QUERY SELECT 'ORIGIN_OR_RP_MISMATCH', NULL::uuid, NULL::uuid, NULL::timestamptz, NULL, NULL, NULL::uuid; RETURN;
 END IF;
 IF p_user_verified IS NOT TRUE THEN
   PERFORM warehouse_identity.central_fail_challenge_v1(a.auth_challenge_id, p_claim_hash, 'USER_VERIFICATION_REQUIRED');
   RETURN QUERY SELECT 'USER_VERIFICATION_REQUIRED', NULL::uuid, NULL::uuid, NULL::timestamptz, NULL, NULL, NULL::uuid; RETURN;
 END IF;
 SELECT * INTO p FROM warehouse_identity.central_passkeys x WHERE x.central_passkey_id = p_central_passkey_id AND x.rp_id = a.expected_rp_id FOR UPDATE;
 IF p.central_passkey_id IS NULL OR p.security_state <> 'ACTIVE' OR NOT warehouse_identity.central_user_active_v1(p.user_id) THEN
   PERFORM warehouse_identity.central_fail_challenge_v1(a.auth_challenge_id, p_claim_hash, 'CREDENTIAL_OR_USER_NOT_ACTIVE');
   RETURN QUERY SELECT 'CREDENTIAL_OR_USER_NOT_ACTIVE', NULL::uuid, NULL::uuid, NULL::timestamptz, NULL, NULL, NULL::uuid; RETURN;
 END IF;
 IF p.row_version <> p_expected_row_version OR p.sign_count <> p_prior_sign_count THEN
   PERFORM warehouse_identity.central_fail_challenge_v1(a.auth_challenge_id, p_claim_hash, 'PASSKEY_STATE_CHANGED');
   RETURN QUERY SELECT 'PASSKEY_STATE_CHANGED', NULL::uuid, NULL::uuid, NULL::timestamptz, NULL, NULL, NULL::uuid; RETURN;
 END IF;
 -- Counter: an authenticator that counts must move forward. Synced passkeys report 0 forever (allowed).
 IF p_observed_sign_count IS NULL OR p_observed_sign_count < 0
  OR ((p_observed_sign_count > 0 OR p.sign_count > 0) AND p_observed_sign_count <= p.sign_count) THEN
   UPDATE warehouse_identity.central_passkeys SET security_state = 'SUSPENDED', suspended_at = v_now, suspension_reason = 'COUNTER_REGRESSION',
          row_version = row_version + 1 WHERE central_passkey_id = p.central_passkey_id;
   PERFORM warehouse_identity.central_fail_challenge_v1(a.auth_challenge_id, p_claim_hash, 'COUNTER_REGRESSION');
   RETURN QUERY SELECT 'COUNTER_REGRESSION', NULL::uuid, NULL::uuid, NULL::timestamptz, NULL, NULL, NULL::uuid; RETURN;
 END IF;
 UPDATE warehouse_identity.central_passkeys SET sign_count = p_observed_sign_count, last_used_at = v_now, row_version = row_version + 1,
        backed_up = coalesce(p_backed_up, backed_up)
  WHERE central_passkey_id = p.central_passkey_id;
 INSERT INTO warehouse_identity.webauthn_verification_evidence (auth_challenge_id, ceremony_type, user_id, passkey_id, credential_id,
   verified_origin, verified_rp_id, user_verified, authenticator_data_sha256, client_data_json_sha256, signature_sha256,
   observed_sign_count, prior_sign_count, counter_anomaly, backup_eligible, backed_up, verifier_service, verifier_version,
   verifier_instance_id, verified_at, request_id, correlation_id, details)
 VALUES (a.auth_challenge_id, 'PASSKEY_AUTHENTICATION', p.user_id, NULL, p.credential_id, p_verified_origin, p_verified_rp_id, true,
   p_authenticator_data_sha256, p_client_data_json_sha256, p_signature_sha256, p_observed_sign_count, p.sign_count, false,
   p_backup_eligible, p_backed_up, p_verifier_service, p_verifier_version, p_verifier_instance_id, v_now, p_request_id, p_correlation_id,
   jsonb_build_object('purpose', 'EOC_OIDC_LOGIN', 'centralPasskeyId', p.central_passkey_id, 'issuer', c.issuer,
                      'interactionId', c.interaction_id, 'issuerRequestId', c.issuer_request_id))
 RETURNING webauthn_verification_evidence_id INTO v_ev;
 UPDATE warehouse_identity.auth_challenges SET user_id = p.user_id, consumed_at = v_now, result = 'SUCCEEDED', verified_origin = p_verified_origin,
        verified_rp_id = p_verified_rp_id, user_verification_performed = true, verification_evidence_id = v_ev, credential_id = p.credential_id
  WHERE auth_challenge_id = a.auth_challenge_id;
 RETURN QUERY SELECT 'SUCCEEDED', p.user_id, v_ev, v_now, c.issuer, c.interaction_id, c.issuer_request_id;
END $fn$;

-- (f) ownership and privileges --------------------------------------------------------------------------------------
DO $own$
DECLARE f text;
BEGIN
 FOREACH f IN ARRAY ARRAY[
   'warehouse_identity.central_user_active_v1(uuid)',
   'warehouse_identity.central_claim_workload_nonce_v1(bytea,uuid,uuid,timestamptz)',
   'warehouse_identity.central_issue_invite_v1(uuid,uuid,bytea,text,integer,text,uuid)',
   'warehouse_identity.central_revoke_passkey_v1(uuid,uuid,text)',
   'warehouse_identity.central_enrollment_begin_v1(bytea,text,text,bytea,uuid,uuid)',
   'warehouse_identity.central_login_begin_v1(text,text,uuid,text,text,bytea,uuid,uuid,integer)',
   'warehouse_identity.central_claim_challenge_v1(uuid,bytea,bytea,text,text,text,text,uuid)',
   'warehouse_identity.central_held_claim_v1(uuid,bytea,bigint,text)',
   'warehouse_identity.central_fail_challenge_v1(uuid,bytea,text)',
   'warehouse_identity.central_passkey_material_v1(text,text)',
   'warehouse_identity.central_finalize_enrollment_v1(uuid,bytea,bigint,text,bytea,integer,text[],uuid,text,boolean,boolean,text,text,text,boolean,text,text,text,text,text,text,uuid,uuid)',
   'warehouse_identity.central_finalize_login_v1(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  EXECUTE format('ALTER FUNCTION %s OWNER TO tcds_identity_function_owner', f);
 END LOOP;
END $own$;
GRANT EXECUTE ON FUNCTION warehouse_identity.central_issue_invite_v1(uuid,uuid,bytea,text,integer,text,uuid),
  warehouse_identity.central_revoke_passkey_v1(uuid,uuid,text) TO tcds_identity_central_admin;
GRANT EXECUTE ON FUNCTION warehouse_identity.central_enrollment_begin_v1(bytea,text,text,bytea,uuid,uuid),
  warehouse_identity.central_login_begin_v1(text,text,uuid,text,text,bytea,uuid,uuid,integer),
  warehouse_identity.central_claim_challenge_v1(uuid,bytea,bytea,text,text,text,text,uuid),
  warehouse_identity.central_claim_workload_nonce_v1(bytea,uuid,uuid,timestamptz),
  warehouse_identity.central_fail_challenge_v1(uuid,bytea,text),
  warehouse_identity.central_passkey_material_v1(text,text),
  warehouse_identity.central_finalize_enrollment_v1(uuid,bytea,bigint,text,bytea,integer,text[],uuid,text,boolean,boolean,text,text,text,boolean,text,text,text,text,text,text,uuid,uuid),
  warehouse_identity.central_finalize_login_v1(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid)
  TO tcds_identity_central_verifier;

DO $down$ BEGIN
 IF NOT (SELECT had_create FROM r626_m) THEN EXECUTE 'REVOKE CREATE ON SCHEMA warehouse_identity FROM tcds_identity_function_owner'; END IF;
 IF (SELECT need FROM r626_m) THEN
  IF (SELECT had FROM r626_m) THEN
   EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT %s, SET %s', current_user,
                  (SELECT m_inherit FROM r626_m)::text, (SELECT m_set FROM r626_m)::text);
  ELSE EXECUTE format('REVOKE tcds_identity_function_owner FROM %I', current_user); END IF;
 END IF;
END $down$;

-- (g) self-verify ----------------------------------------------------------------------------------------------------
DO $verify$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid::regprocedure AS f, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'warehouse_identity' AND p.proname LIKE 'central\_%' LOOP
  IF r.owner <> 'tcds_identity_function_owner' OR NOT r.prosecdef OR r.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
   THEN RAISE EXCEPTION 'R626_FUNCTION_SETUP_WRONG %', r.f; END IF;
  IF has_function_privilege('public', r.f, 'EXECUTE') OR has_function_privilege('anon', r.f, 'EXECUTE')
     OR has_function_privilege('authenticated', r.f, 'EXECUTE') OR has_function_privilege('service_role', r.f, 'EXECUTE')
   THEN RAISE EXCEPTION 'R626_EXECUTE_TOO_BROAD %', r.f; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'warehouse_identity' AND p.proname LIKE 'central\_%') <> 12
  THEN RAISE EXCEPTION 'R626_FUNCTION_COUNT_WRONG'; END IF;
 IF has_table_privilege('tcds_identity_central_verifier', 'warehouse_identity.central_passkeys', 'SELECT')
  OR has_table_privilege('tcds_identity_central_verifier', 'warehouse_identity.auth_challenges', 'SELECT')
  OR has_table_privilege('tcds_identity_central_admin', 'warehouse_identity.central_enrollment_invites', 'SELECT')
  THEN RAISE EXCEPTION 'R626_ROLE_HAS_TABLE_ACCESS'; END IF;
 IF pg_has_role(current_user, 'tcds_identity_function_owner', 'SET') AND (SELECT need FROM r626_m)
  THEN RAISE EXCEPTION 'R626_TEMPORARY_MEMBERSHIP_NOT_RESTORED'; END IF;
END $verify$;
COMMIT;
