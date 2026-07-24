BEGIN;

CREATE SCHEMA IF NOT EXISTS warehouse_identity;

CREATE TABLE IF NOT EXISTS warehouse_identity.users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  normalized_username text GENERATED ALWAYS AS (lower(btrim(username))) STORED,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LOCKED','SUSPENDED','DISABLED','ARCHIVED')),
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until timestamptz,
  password_changed_at timestamptz,
  last_authenticated_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at timestamptz,
  CONSTRAINT users_username_not_blank CHECK (btrim(username) <> ''),
  CONSTRAINT users_display_name_not_blank CHECK (btrim(display_name) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_users_normalized_username_active
  ON warehouse_identity.users(normalized_username) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_identity_users_status_locked
  ON warehouse_identity.users(status, locked_until);

CREATE TABLE IF NOT EXISTS warehouse_identity.employees (
  employee_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  employee_number text NOT NULL,
  normalized_employee_number text GENERATED ALWAYS AS (upper(btrim(employee_number))) STORED,
  facility_id uuid NOT NULL REFERENCES warehouse.facilities(facility_id) ON DELETE RESTRICT,
  default_station_id uuid REFERENCES warehouse.stations(station_id) ON DELETE RESTRICT,
  employment_status text NOT NULL DEFAULT 'ACTIVE' CHECK (employment_status IN ('ACTIVE','LEAVE','SUSPENDED','TERMINATED')),
  hired_at date,
  terminated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT employees_number_not_blank CHECK (btrim(employee_number) <> ''),
  CONSTRAINT employees_termination_consistency CHECK ((employment_status = 'TERMINATED') = (terminated_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_employees_number
  ON warehouse_identity.employees(normalized_employee_number);
CREATE INDEX IF NOT EXISTS ix_identity_employees_facility_status
  ON warehouse_identity.employees(facility_id, employment_status);

CREATE TABLE IF NOT EXISTS warehouse_identity.password_credentials (
  password_credential_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES warehouse_identity.users(user_id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  hashing_algorithm text NOT NULL DEFAULT 'ARGON2ID' CHECK (hashing_algorithm = 'ARGON2ID'),
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  must_change boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CONSTRAINT password_hash_format CHECK (password_hash LIKE '$argon2id$%')
);
CREATE INDEX IF NOT EXISTS ix_identity_password_credentials_active
  ON warehouse_identity.password_credentials(user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS warehouse_identity.roles (
  role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_code text NOT NULL,
  role_name text NOT NULL,
  permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT roles_code_format CHECK (role_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_roles_code ON warehouse_identity.roles(role_code);

CREATE TABLE IF NOT EXISTS warehouse_identity.user_role_assignments (
  user_role_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES warehouse_identity.roles(role_id) ON DELETE RESTRICT,
  facility_id uuid REFERENCES warehouse.facilities(facility_id) ON DELETE RESTRICT,
  station_id uuid REFERENCES warehouse.stations(station_id) ON DELETE RESTRICT,
  valid_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  valid_until timestamptz,
  assigned_by uuid REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT role_assignment_validity CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT role_assignment_revocation CHECK (revoked_at IS NULL OR revoked_by IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_user_role_scope_active
  ON warehouse_identity.user_role_assignments(user_id, role_id, COALESCE(facility_id,'00000000-0000-0000-0000-000000000000'::uuid), COALESCE(station_id,'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_identity_role_assignments_user_validity
  ON warehouse_identity.user_role_assignments(user_id, valid_from, valid_until) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS warehouse_identity.passkeys (
  passkey_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE CASCADE,
  enrolled_device_id uuid REFERENCES warehouse.devices(device_id) ON DELETE RESTRICT,
  credential_id text NOT NULL,
  public_key bytea NOT NULL,
  public_key_algorithm integer NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports text[] NOT NULL DEFAULT ARRAY[]::text[],
  aaguid uuid,
  credential_device_type text,
  backup_eligible boolean NOT NULL DEFAULT false,
  backed_up boolean NOT NULL DEFAULT false,
  friendly_name text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  revocation_reason text,
  row_version bigint NOT NULL DEFAULT 1,
  CONSTRAINT passkey_credential_not_blank CHECK (btrim(credential_id) <> ''),
  CONSTRAINT passkey_revocation_consistency CHECK (revoked_at IS NULL OR revoked_by IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_passkeys_credential_id ON warehouse_identity.passkeys(credential_id);
CREATE INDEX IF NOT EXISTS ix_identity_passkeys_user_active ON warehouse_identity.passkeys(user_id, last_used_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS warehouse_identity.auth_challenges (
  auth_challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES warehouse_identity.users(user_id) ON DELETE CASCADE,
  device_id uuid REFERENCES warehouse.devices(device_id) ON DELETE RESTRICT,
  ceremony_type text NOT NULL CHECK (ceremony_type IN ('PASSKEY_REGISTRATION','PASSKEY_AUTHENTICATION')),
  challenge_hash bytea NOT NULL,
  expected_origin text NOT NULL,
  expected_rp_id text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  result text CHECK (result IS NULL OR result IN ('PROCESSING','SUCCEEDED','FAILED','EXPIRED')),
  failure_code text,
  CONSTRAINT challenge_lifetime CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_challenges_hash ON warehouse_identity.auth_challenges(challenge_hash);
CREATE INDEX IF NOT EXISTS ix_identity_challenges_active
  ON warehouse_identity.auth_challenges(user_id, ceremony_type, expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS warehouse_identity.auth_sessions (
  auth_session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES warehouse_identity.employees(employee_id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES warehouse.devices(device_id) ON DELETE RESTRICT,
  warehouse_device_session_id uuid NOT NULL UNIQUE REFERENCES warehouse.device_sessions(session_id) ON DELETE RESTRICT,
  authentication_method text NOT NULL CHECK (authentication_method IN ('PASSWORD','PASSKEY')),
  assurance_level text NOT NULL DEFAULT 'AAL1' CHECK (assurance_level IN ('AAL1','AAL2')),
  token_hash bytea NOT NULL,
  csrf_token_hash bytea,
  source_ip inet,
  user_agent_hash bytea,
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_activity_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
  revocation_reason text,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  CONSTRAINT session_expiry_order CHECK (idle_expires_at > issued_at AND absolute_expires_at > idle_expires_at),
  CONSTRAINT session_max_duration CHECK (absolute_expires_at <= issued_at + interval '8 hours')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_auth_sessions_token_hash ON warehouse_identity.auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS ix_identity_auth_sessions_user_active
  ON warehouse_identity.auth_sessions(user_id, last_activity_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_identity_auth_sessions_expiry
  ON warehouse_identity.auth_sessions(idle_expires_at, absolute_expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS warehouse_identity.login_attempts (
  login_attempt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES warehouse_identity.users(user_id) ON DELETE SET NULL,
  employee_number text,
  device_id uuid REFERENCES warehouse.devices(device_id) ON DELETE SET NULL,
  authentication_method text NOT NULL CHECK (authentication_method IN ('PASSWORD','PASSKEY')),
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS','FAILURE','BLOCKED')),
  failure_code text,
  source_ip inet,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_identity_login_attempts_user_time ON warehouse_identity.login_attempts(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_identity_login_attempts_ip_time ON warehouse_identity.login_attempts(source_ip, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_identity_login_attempts_failures ON warehouse_identity.login_attempts(occurred_at DESC) WHERE outcome <> 'SUCCESS';

CREATE OR REPLACE FUNCTION warehouse_identity.touch_row()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  IF to_jsonb(NEW) ? 'row_version' THEN NEW.row_version := COALESCE(OLD.row_version,0) + 1; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_identity_users_touch ON warehouse_identity.users;
CREATE TRIGGER trg_identity_users_touch BEFORE UPDATE ON warehouse_identity.users
FOR EACH ROW EXECUTE FUNCTION warehouse_identity.touch_row();
DROP TRIGGER IF EXISTS trg_identity_employees_touch ON warehouse_identity.employees;
CREATE TRIGGER trg_identity_employees_touch BEFORE UPDATE ON warehouse_identity.employees
FOR EACH ROW EXECUTE FUNCTION warehouse_identity.touch_row();
DROP TRIGGER IF EXISTS trg_identity_roles_touch ON warehouse_identity.roles;
CREATE TRIGGER trg_identity_roles_touch BEFORE UPDATE ON warehouse_identity.roles
FOR EACH ROW EXECUTE FUNCTION warehouse_identity.touch_row();

CREATE OR REPLACE FUNCTION warehouse_identity.resolve_login_identity(p_identifier text)
RETURNS TABLE(user_id uuid, employee_id uuid, username text, employee_number text, display_name text, status text, employment_status text, facility_id uuid, default_station_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = warehouse_identity, warehouse, pg_temp AS $$
  SELECT u.user_id, e.employee_id, u.username, e.employee_number, u.display_name, u.status, e.employment_status, e.facility_id, e.default_station_id
  FROM warehouse_identity.users u
  JOIN warehouse_identity.employees e ON e.user_id = u.user_id
  WHERE u.archived_at IS NULL
    AND (u.normalized_username = lower(btrim(p_identifier)) OR e.normalized_employee_number = upper(btrim(p_identifier)))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION warehouse_identity.consume_challenge(p_challenge_hash bytea, p_ceremony_type text)
RETURNS warehouse_identity.auth_challenges
LANGUAGE plpgsql SECURITY DEFINER SET search_path = warehouse_identity, pg_temp AS $$
DECLARE v_row warehouse_identity.auth_challenges;
BEGIN
  UPDATE warehouse_identity.auth_challenges
     SET consumed_at = clock_timestamp(), result = 'PROCESSING'
   WHERE challenge_hash = p_challenge_hash
     AND ceremony_type = p_ceremony_type
     AND consumed_at IS NULL
     AND expires_at > clock_timestamp()
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge invalid, expired, or already consumed' USING ERRCODE = 'P0001'; END IF;
  RETURN v_row;
END; $$;

CREATE OR REPLACE PROCEDURE warehouse_identity.revoke_session(p_auth_session_id uuid, p_reason text, p_revoked_by uuid DEFAULT NULL)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = warehouse_identity, warehouse, pg_temp AS $$
DECLARE v_device_session uuid;
BEGIN
  UPDATE warehouse_identity.auth_sessions
     SET revoked_at = COALESCE(revoked_at, clock_timestamp()), revoked_by = COALESCE(revoked_by,p_revoked_by), revocation_reason = COALESCE(revocation_reason,p_reason)
   WHERE auth_session_id = p_auth_session_id
   RETURNING warehouse_device_session_id INTO v_device_session;
  IF v_device_session IS NOT NULL THEN
    UPDATE warehouse.device_sessions SET ended_at = COALESCE(ended_at,clock_timestamp()), end_reason = COALESCE(end_reason,p_reason) WHERE session_id = v_device_session;
  END IF;
END; $$;

CREATE OR REPLACE VIEW warehouse_identity.v_active_user_access AS
SELECT u.user_id, e.employee_id, u.username, e.employee_number, u.display_name,
       e.facility_id, e.default_station_id,
       COALESCE(array_agg(DISTINCT r.role_code) FILTER (WHERE r.role_code IS NOT NULL), ARRAY[]::text[]) AS roles,
       COALESCE(array_agg(DISTINCT permission) FILTER (WHERE permission IS NOT NULL), ARRAY[]::text[]) AS permissions,
       EXISTS (SELECT 1 FROM warehouse_identity.passkeys p WHERE p.user_id=u.user_id AND p.revoked_at IS NULL) AS passkey_enrolled
FROM warehouse_identity.users u
JOIN warehouse_identity.employees e ON e.user_id=u.user_id
LEFT JOIN warehouse_identity.user_role_assignments ura ON ura.user_id=u.user_id AND ura.revoked_at IS NULL AND ura.valid_from <= clock_timestamp() AND (ura.valid_until IS NULL OR ura.valid_until > clock_timestamp())
LEFT JOIN warehouse_identity.roles r ON r.role_id=ura.role_id AND r.active
LEFT JOIN LATERAL unnest(COALESCE(r.permissions,ARRAY[]::text[])) permission ON true
WHERE u.status='ACTIVE' AND u.archived_at IS NULL AND e.employment_status='ACTIVE'
GROUP BY u.user_id,e.employee_id,e.facility_id,e.default_station_id;

CREATE OR REPLACE VIEW warehouse_identity.v_active_sessions AS
SELECT s.auth_session_id,s.user_id,e.employee_number,u.display_name,s.device_id,s.authentication_method,s.assurance_level,s.issued_at,s.last_activity_at,s.idle_expires_at,s.absolute_expires_at
FROM warehouse_identity.auth_sessions s
JOIN warehouse_identity.users u ON u.user_id=s.user_id
JOIN warehouse_identity.employees e ON e.employee_id=s.employee_id
WHERE s.revoked_at IS NULL AND s.idle_expires_at > clock_timestamp() AND s.absolute_expires_at > clock_timestamp();

REVOKE ALL ON SCHEMA warehouse_identity FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA warehouse_identity FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA warehouse_identity FROM PUBLIC;

COMMIT;
