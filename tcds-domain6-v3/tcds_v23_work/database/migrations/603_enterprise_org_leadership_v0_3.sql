-- TCDS enterprise_org v0.3 -- REVIEWED CANDIDATE / STAGING ONLY, requires owner/migration approval.
-- Create under an authorized controlled migration role. NO credential/session/permission objects.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, pg_temp;

-- Fail closed rather than letting IF NOT EXISTS silently skip incompatible objects.
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='enterprise_org') THEN
    RAISE EXCEPTION 'ENTERPRISE_ORG_NAMESPACE_EXISTS_RECONCILE_FIRST';
  END IF;
  IF to_regproc('pg_catalog.gen_random_uuid') IS NULL THEN
    RAISE EXCEPTION 'GEN_RANDOM_UUID_UNAVAILABLE';
  END IF;
END $preflight$;

CREATE SCHEMA enterprise_org;
REVOKE ALL ON SCHEMA enterprise_org FROM PUBLIC, anon, authenticated;

CREATE TABLE enterprise_org.leadership_people (
  person_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  person_key text NOT NULL UNIQUE CHECK (person_key ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 200),
  -- Nullable binding pending approved centralized enterprise IAM subject-ownership decision.
  -- No joining or verifying IAM by email, name or phone.
  iam_user_id uuid UNIQUE,
  iam_link_authority text,
  iam_link_evidence_reference text,
  iam_link_verified_at timestamptz,
  -- No sign-in rights are derived from a person or position row.
  record_status text NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (record_status IN ('PENDING_VERIFICATION','VERIFIED','INACTIVE')),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT iam_user_verification_consistency CHECK (record_status <> 'VERIFIED' OR iam_user_id IS NOT NULL),
  CONSTRAINT iam_link_complete CHECK (
    (iam_user_id IS NULL AND iam_link_authority IS NULL AND iam_link_evidence_reference IS NULL AND iam_link_verified_at IS NULL)
    OR (iam_user_id IS NOT NULL AND NULLIF(btrim(iam_link_authority),'') IS NOT NULL
      AND NULLIF(btrim(iam_link_evidence_reference),'') IS NOT NULL AND iam_link_verified_at IS NOT NULL)
  )
);

CREATE TABLE enterprise_org.positions (
  position_code text PRIMARY KEY CHECK (position_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  position_title text NOT NULL UNIQUE CHECK (char_length(btrim(position_title)) BETWEEN 3 AND 160),
  function_key text NOT NULL CHECK (function_key ~ '^[A-Z][A-Z0-9_]+$'),
  executive_all_modules boolean NOT NULL DEFAULT false,
  -- descriptive management attribute ONLY; EOC authorization must come from trusted IAM.
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE enterprise_org.leadership_appointments (
  appointment_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES enterprise_org.leadership_people(person_id) ON DELETE RESTRICT,
  position_code text NOT NULL REFERENCES enterprise_org.positions(position_code) ON DELETE RESTRICT,
  reports_to_appointment_id uuid REFERENCES enterprise_org.leadership_appointments(appointment_id) ON DELETE RESTRICT,
  appointment_status text NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (appointment_status IN ('PENDING_VERIFICATION','ACTIVE','ON_LEAVE','ENDED')),
  effective_from date,
  effective_until date,
  approved_by_iam_user_id uuid,
  approval_reference text,
  approved_at timestamptz,
  ended_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT approval_evidence_consistency CHECK ((approved_by_iam_user_id IS NULL AND approval_reference IS NULL AND approved_at IS NULL) OR (approved_by_iam_user_id IS NOT NULL AND NULLIF(btrim(approval_reference),'') IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT ended_appointment_period CHECK (appointment_status <> 'ENDED' OR effective_until IS NOT NULL),
  CONSTRAINT no_self_reporting CHECK (reports_to_appointment_id IS DISTINCT FROM appointment_id),
  CONSTRAINT valid_appointment_period CHECK (effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until >= effective_from)),
  CONSTRAINT active_appointment_approval CHECK (appointment_status NOT IN ('ACTIVE','ON_LEAVE') OR
    (effective_from IS NOT NULL AND approved_by_iam_user_id IS NOT NULL
     AND NULLIF(btrim(approval_reference),'') IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT ended_appointment_timestamp CHECK (appointment_status <> 'ENDED' OR ended_at IS NOT NULL)
);
-- Allow future reappointment history but forbid two simultaneously current appointments in the same position.
CREATE UNIQUE INDEX ux_enterprise_org_current_appointments
  ON enterprise_org.leadership_appointments(person_id,position_code)
  WHERE appointment_status IN ('PENDING_VERIFICATION','ACTIVE','ON_LEAVE');
CREATE INDEX ix_enterprise_org_appointments_person_status
  ON enterprise_org.leadership_appointments(person_id,appointment_status);
CREATE INDEX ix_enterprise_org_appointments_manager
  ON enterprise_org.leadership_appointments(reports_to_appointment_id)
  WHERE reports_to_appointment_id IS NOT NULL;
CREATE INDEX ix_enterprise_org_appointments_position_status
  ON enterprise_org.leadership_appointments(position_code,appointment_status);

CREATE TABLE enterprise_org.contact_points (
  contact_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES enterprise_org.leadership_people(person_id) ON DELETE RESTRICT,
  contact_type text NOT NULL CHECK (contact_type IN ('EMAIL','PHONE')),
  contact_value text NOT NULL CHECK (char_length(btrim(contact_value)) BETWEEN 3 AND 254),
  contact_purpose text NOT NULL DEFAULT 'BUSINESS'
    CHECK (contact_purpose IN ('BUSINESS','SHARED_INBOX','ALERTS')),
  verified_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT no_misleading_verification CHECK (contact_purpose <> 'SHARED_INBOX' OR verified_at IS NULL OR contact_type='EMAIL'),
  CONSTRAINT contact_format CHECK (
    (contact_type='EMAIL' AND contact_value ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    OR (contact_type='PHONE' AND contact_value ~ '^\+[1-9][0-9]{7,14}$')
  ),
  UNIQUE(person_id,contact_type,contact_value)
);
CREATE INDEX ix_enterprise_org_contact_person
  ON enterprise_org.contact_points(person_id,active);

-- Deliberately no GRANTs to EOC, service_role, anon, authenticated or PUBLIC.
-- Separate approved IAM mapping/admission BFF is required before activating accounts.
-- Keep contact and personnel data in a private schema, never a public exposure.

-- Controlled row maintenance and optimistic concurrency stamp. This does not
-- authorize a business transition; authorization is a separate IAM service obligation.
CREATE FUNCTION enterprise_org.bump_person_version_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $f$
BEGIN
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := clock_timestamp();
  IF OLD.iam_user_id IS NOT NULL AND NEW.iam_user_id IS DISTINCT FROM OLD.iam_user_id THEN
    RAISE EXCEPTION 'IAM_BINDING_IMMUTABLE_AFTER_VERIFICATION' USING ERRCODE='23514';
  END IF;
  IF NEW.record_status = 'INACTIVE' AND EXISTS (
      SELECT 1 FROM enterprise_org.leadership_appointments a
       WHERE a.person_id=NEW.person_id AND a.appointment_status IN ('ACTIVE','ON_LEAVE')
  ) THEN
    RAISE EXCEPTION 'ACTIVE_APPOINTMENTS_MUST_END_BEFORE_PERSON_DEACTIVATION' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER tr_leadership_person_version
BEFORE UPDATE ON enterprise_org.leadership_people
FOR EACH ROW EXECUTE FUNCTION enterprise_org.bump_person_version_v1();

CREATE FUNCTION enterprise_org.guard_appointment_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $f$
DECLARE v_person_verified boolean; v_cycle boolean;
BEGIN
  -- Serialize hierarchy writes to prevent a concurrent cross-edge cycle.
  PERFORM pg_advisory_xact_lock(81742, 1);
  IF TG_OP = 'UPDATE' THEN
    IF NEW.appointment_id IS DISTINCT FROM OLD.appointment_id OR
       NEW.person_id IS DISTINCT FROM OLD.person_id THEN
      RAISE EXCEPTION 'APPOINTMENT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := clock_timestamp();
  END IF;

  IF NEW.appointment_status IN ('ACTIVE','ON_LEAVE') THEN
    SELECT p.record_status='VERIFIED' AND p.iam_user_id IS NOT NULL
      INTO v_person_verified
      FROM enterprise_org.leadership_people p WHERE p.person_id=NEW.person_id FOR SHARE;
    IF NOT COALESCE(v_person_verified,false) THEN
      RAISE EXCEPTION 'ACTIVE_APPOINTMENT_REQUIRES_VERIFIED_IAM_SUBJECT' USING ERRCODE='23514';
    END IF;
  END IF;

  IF NEW.reports_to_appointment_id IS NOT NULL THEN
    -- A pending reporting pointer can only point to a record which exists.
    -- Reject cross-employee self-reporting and recursive reporting chains.
    WITH RECURSIVE chain(appointment_id, parent_id, path) AS (
      SELECT a.appointment_id, a.reports_to_appointment_id, ARRAY[a.appointment_id]
        FROM enterprise_org.leadership_appointments a
        WHERE a.appointment_id=NEW.reports_to_appointment_id
      UNION ALL
      SELECT p.appointment_id,p.reports_to_appointment_id,chain.path || p.appointment_id
        FROM enterprise_org.leadership_appointments p JOIN chain ON p.appointment_id=chain.parent_id
       WHERE NOT p.appointment_id=ANY(chain.path)
    )
    SELECT EXISTS (SELECT 1 FROM chain WHERE appointment_id=NEW.appointment_id)
      INTO v_cycle;
    IF v_cycle THEN RAISE EXCEPTION 'REPORTING_CYCLE_PROHIBITED' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER tr_leadership_appointment_guard
BEFORE INSERT OR UPDATE ON enterprise_org.leadership_appointments
FOR EACH ROW EXECUTE FUNCTION enterprise_org.guard_appointment_v1();

CREATE FUNCTION enterprise_org.touch_directory_record_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $f$
BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $f$;
CREATE TRIGGER tr_leadership_position_updated BEFORE UPDATE ON enterprise_org.positions
FOR EACH ROW EXECUTE FUNCTION enterprise_org.touch_directory_record_v1();
CREATE TRIGGER tr_leadership_contact_updated BEFORE UPDATE ON enterprise_org.contact_points
FOR EACH ROW EXECUTE FUNCTION enterprise_org.touch_directory_record_v1();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA enterprise_org FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA enterprise_org REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Do NOT expose to anon/authenticated or the public Data API.
REVOKE ALL ON ALL TABLES IN SCHEMA enterprise_org FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA enterprise_org REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER TABLE enterprise_org.leadership_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_org.leadership_people FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise_org.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_org.positions FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise_org.leadership_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_org.leadership_appointments FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise_org.contact_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_org.contact_points FORCE ROW LEVEL SECURITY;
-- No permissive client RLS policies. Governed backend reader grants are separate, reviewed migration.
COMMIT;
