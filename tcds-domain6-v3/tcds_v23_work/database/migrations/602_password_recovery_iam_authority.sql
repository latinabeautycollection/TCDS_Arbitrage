-- TCDS Domain 6 / Slice 6.2: additive IAM governance.
-- Apply ONLY after review and to an isolated warehouse schema clone first.
-- Assumes the authoritative warehouse_identity and warehouse_audit schemas exist.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
 IF to_regclass('warehouse_identity.password_reset_requests') IS NULL OR
    to_regclass('warehouse_identity.user_role_assignments') IS NULL OR
    to_regclass('warehouse_identity.webauthn_verification_evidence') IS NULL OR
    to_regclass('warehouse_audit.security_events') IS NULL THEN
  RAISE EXCEPTION 'SLICE_6_2_MISSING_AUTHORITATIVE_SCHEMA';
 END IF;
 IF to_regprocedure('warehouse_identity.resolve_session_access(uuid,text)') IS NULL THEN
  RAISE EXCEPTION 'SLICE_6_2_MISSING_SESSION_AUTHORITY';
 END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS warehouse_identity.password_recovery_overrides_v62 (
 override_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 target_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 target_facility_id uuid NOT NULL REFERENCES warehouse.facilities(facility_id),
 authorized_by uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 authorized_session_id uuid NOT NULL REFERENCES warehouse_identity.auth_sessions(auth_session_id),
 assurance_evidence_id uuid NOT NULL REFERENCES warehouse_identity.webauthn_verification_evidence(webauthn_verification_evidence_id),
 reason_code text NOT NULL CHECK (length(btrim(reason_code)) BETWEEN 3 AND 80),
 justification text NOT NULL CHECK (length(btrim(justification)) BETWEEN 15 AND 1000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 consumed_by_request_id uuid UNIQUE REFERENCES warehouse_identity.password_reset_requests(password_reset_request_id),
 revoked_at timestamptz,
 request_id uuid NOT NULL UNIQUE,
 correlation_id uuid NOT NULL,
 row_version bigint NOT NULL DEFAULT 1,
 CONSTRAINT recovery_override_no_self CHECK (target_user_id <> authorized_by),
 CONSTRAINT recovery_override_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes'),
 CONSTRAINT recovery_override_consumption CHECK ((consumed_at IS NULL) = (consumed_by_request_id IS NULL))
);
-- Seed a dedicated manager capability role, but DO NOT assign it to every supervisor.
-- Explicit, facility-scoped assignments are required before this role is usable.
INSERT INTO warehouse_identity.roles(role_code,role_name,permissions,active)
SELECT 'WAREHOUSE_RECOVERY_MANAGER','Warehouse Password Recovery Exception Manager',
       ARRAY['warehouse:identity:password:override_24h']::text[],true
WHERE NOT EXISTS (SELECT 1 FROM warehouse_identity.roles WHERE role_code='WAREHOUSE_RECOVERY_MANAGER');

-- A step-up proof can authorize at most ONE privileged recovery action.
-- Purpose-scoped authorizations may ONLY be written by an independently authorized
-- step-up verifier. Login WebAuthn evidence, even if recent, is not sufficient.
CREATE TABLE IF NOT EXISTS warehouse_identity.password_recovery_stepup_authorizations_v62 (
 evidence_id uuid PRIMARY KEY REFERENCES warehouse_identity.webauthn_verification_evidence(webauthn_verification_evidence_id),
 actor_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 actor_session_id uuid NOT NULL REFERENCES warehouse_identity.auth_sessions(auth_session_id),
 target_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 target_reset_request_id uuid REFERENCES warehouse_identity.password_reset_requests(password_reset_request_id),
 action text NOT NULL CHECK (action IN ('OVERRIDE','APPROVE')),
 verified_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 verification_ceremony_id uuid NOT NULL UNIQUE,
 issued_by_verifier text NOT NULL CHECK (length(btrim(issued_by_verifier))>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (expires_at>verified_at AND expires_at<=verified_at+interval '5 minutes'),
 CHECK ((action='APPROVE' AND target_reset_request_id IS NOT NULL) OR
        (action='OVERRIDE' AND target_reset_request_id IS NULL))
);
ALTER TABLE warehouse_identity.password_recovery_stepup_authorizations_v62 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.password_recovery_stepup_authorizations_v62 FROM PUBLIC, anon, authenticated;

-- A step-up proof can authorize at most ONE privileged recovery action.
CREATE TABLE IF NOT EXISTS warehouse_identity.password_recovery_stepup_uses_v62 (
 evidence_id uuid PRIMARY KEY REFERENCES warehouse_identity.webauthn_verification_evidence(webauthn_verification_evidence_id),
 actor_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 action text NOT NULL CHECK(action IN ('OVERRIDE','APPROVE')),
 target_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 request_id uuid NOT NULL,
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE warehouse_identity.password_recovery_stepup_uses_v62 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.password_recovery_stepup_uses_v62 FROM PUBLIC, anon, authenticated;

-- Registration is intentionally a separate verifier-only database boundary.
-- This function does not perform cryptographic verification: the existing
-- WebAuthn verifier MUST do so and MUST verify an action-specific challenge
-- before it calls this function. Never grant to the ordinary IAM API role.
CREATE OR REPLACE FUNCTION warehouse_identity.register_password_recovery_stepup_v62(
 p_evidence_id uuid,p_auth_session_id uuid,p_target_user_id uuid,
 p_target_reset_request_id uuid,p_action text,p_ceremony_id uuid,p_verifier_name text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog','warehouse_identity' AS $register$
DECLARE v_user uuid; v_device uuid; v_now timestamptz:=clock_timestamp(); v_verified timestamptz;
BEGIN
 IF p_action NOT IN ('APPROVE','OVERRIDE') OR p_evidence_id IS NULL OR
    p_auth_session_id IS NULL OR p_target_user_id IS NULL OR p_ceremony_id IS NULL OR
    length(btrim(coalesce(p_verifier_name,'')))<3 THEN
   RAISE EXCEPTION 'INVALID_STEPUP_REGISTRATION' USING ERRCODE='22023';
 END IF;
 IF (p_action='APPROVE') IS DISTINCT FROM (p_target_reset_request_id IS NOT NULL) THEN
   RAISE EXCEPTION 'STEPUP_PURPOSE_MISMATCH' USING ERRCODE='22023';
 END IF;
 SELECT s.user_id,s.device_id INTO v_user,v_device
 FROM warehouse_identity.auth_sessions s
 WHERE s.auth_session_id=p_auth_session_id AND s.revoked_at IS NULL
   AND s.idle_expires_at>v_now AND s.absolute_expires_at>v_now;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STEPUP_SESSION' USING ERRCODE='42501'; END IF;
 SELECT e.verified_at INTO v_verified
 FROM warehouse_identity.webauthn_verification_evidence e
 JOIN warehouse_identity.passkeys p ON p.passkey_id=e.passkey_id
 WHERE e.webauthn_verification_evidence_id=p_evidence_id
   AND e.user_id=v_user AND e.user_verified IS TRUE
   AND e.verified_at BETWEEN v_now-interval '5 minutes' AND v_now
   AND p.user_id=v_user AND p.enrolled_device_id=v_device AND p.revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNVERIFIED_STEPUP_EVIDENCE' USING ERRCODE='42501'; END IF;
 IF p_action='APPROVE' AND NOT EXISTS (
  SELECT 1 FROM warehouse_identity.password_reset_requests r
  WHERE r.password_reset_request_id=p_target_reset_request_id AND r.user_id=p_target_user_id
 ) THEN RAISE EXCEPTION 'STEPUP_REQUEST_MISMATCH' USING ERRCODE='42501'; END IF;
 INSERT INTO warehouse_identity.password_recovery_stepup_authorizations_v62
 (evidence_id,actor_user_id,actor_session_id,target_user_id,target_reset_request_id,action,
 verified_at,expires_at,verification_ceremony_id,issued_by_verifier)
 VALUES(p_evidence_id,v_user,p_auth_session_id,p_target_user_id,p_target_reset_request_id,p_action,
 v_verified,least(v_verified+interval '5 minutes',v_now+interval '5 minutes'),p_ceremony_id,p_verifier_name);
 RETURN true;
END $register$;
REVOKE ALL ON FUNCTION warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text)
 FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS recovery_override_target_idx ON warehouse_identity.password_recovery_overrides_v62(target_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS recovery_request_recent_v62_idx ON warehouse_identity.password_reset_requests(user_id,created_at DESC) WHERE request_type='SELF_SERVICE';
-- Requests must have a unique trusted transport idempotency key; fail migration
-- on pre-existing duplicates rather than silently accepting a broken guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS recovery_request_source_id_v62_uq ON
 warehouse_identity.password_reset_requests(request_id) WHERE request_type='SELF_SERVICE';
-- Never expose this table directly through Supabase client roles.
ALTER TABLE warehouse_identity.password_recovery_overrides_v62 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.password_recovery_overrides_v62 FROM PUBLIC, anon, authenticated;

-- Domain 6.2 uses the existing role registry, without granting ALL supervisors the permission.
-- Only a separately approved, active manager role with an explicit facility-scoped
-- user_role_assignment may exercise the authority. Role assignment is a later governance action.

CREATE OR REPLACE FUNCTION warehouse_identity.authorize_password_recovery_override_v62(
 p_manager_auth_session_id uuid,p_target_user_id uuid,p_step_up_evidence_id uuid,
 p_reason_code text,p_justification text,p_request_id uuid,p_correlation_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog','warehouse_identity' AS $fn$
DECLARE a record; s record; v_facility uuid; v_authorized uuid; v_now timestamptz := clock_timestamp();
BEGIN
 IF p_request_id IS NULL OR p_correlation_id IS NULL OR p_target_user_id IS NULL OR p_step_up_evidence_id IS NULL OR
    length(btrim(coalesce(p_justification,''))) NOT BETWEEN 15 AND 1000 OR
    length(btrim(coalesce(p_reason_code,''))) NOT BETWEEN 3 AND 80 THEN
  RAISE EXCEPTION 'INVALID_OVERRIDE_REQUEST' USING ERRCODE='22023';
 END IF;
 SELECT * INTO a FROM warehouse_identity.resolve_session_access(p_manager_auth_session_id,'warehouse:identity:password:override_24h') LIMIT 1;
 IF NOT FOUND OR a.access_allowed IS DISTINCT FROM true OR a.assurance_level IS DISTINCT FROM 'AAL2' OR a.user_id IS NULL THEN
  RAISE EXCEPTION 'OVERRIDE_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 SELECT user_id,device_id,revoked_at,idle_expires_at,absolute_expires_at INTO s
 FROM warehouse_identity.auth_sessions WHERE auth_session_id=p_manager_auth_session_id;
 IF NOT FOUND OR s.user_id IS DISTINCT FROM a.user_id OR s.revoked_at IS NOT NULL OR s.idle_expires_at<=v_now OR s.absolute_expires_at <= v_now THEN
  RAISE EXCEPTION 'INVALID_MANAGER_SESSION' USING ERRCODE='42501';
 END IF;
 IF a.user_id=p_target_user_id THEN RAISE EXCEPTION 'SELF_OVERRIDE_PROHIBITED' USING ERRCODE='42501'; END IF;
 SELECT e.facility_id INTO v_facility FROM warehouse_identity.employees e
 JOIN warehouse_identity.users u ON u.user_id=e.user_id
 WHERE e.user_id=p_target_user_id AND e.employment_status='ACTIVE' AND u.status='ACTIVE';
 IF v_facility IS NULL THEN RAISE EXCEPTION 'INACTIVE_TARGET' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM warehouse_identity.user_role_assignments ra
   JOIN warehouse_identity.roles r ON r.role_id=ra.role_id
   WHERE ra.user_id=a.user_id AND ra.facility_id=v_facility AND ra.revoked_at IS NULL
     AND ra.valid_from<=v_now AND (ra.valid_until IS NULL OR ra.valid_until>v_now)
     AND r.active AND 'warehouse:identity:password:override_24h'=ANY(r.permissions)
 ) THEN RAISE EXCEPTION 'MANAGER_FACILITY_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 -- Require an action-specific authorization pre-registered by the trusted WebAuthn
 -- verifier; standalone login evidence is intentionally rejected.
 IF NOT EXISTS (
  SELECT 1 FROM warehouse_identity.password_recovery_stepup_authorizations_v62 au
  JOIN warehouse_identity.webauthn_verification_evidence we
   ON we.webauthn_verification_evidence_id=au.evidence_id
  JOIN warehouse_identity.passkeys pk ON pk.passkey_id=we.passkey_id
  WHERE au.evidence_id=p_step_up_evidence_id AND au.action='OVERRIDE'
    AND au.actor_user_id=a.user_id AND au.actor_session_id=p_manager_auth_session_id
    AND au.target_user_id=p_target_user_id AND au.target_reset_request_id IS NULL
    AND au.expires_at>v_now AND we.verified_at>=v_now-interval '5 minutes'
    AND we.user_verified AND pk.user_id=a.user_id AND pk.enrolled_device_id=s.device_id
    AND pk.revoked_at IS NULL
 ) THEN RAISE EXCEPTION 'FRESH_PURPOSE_BOUND_STEP_UP_REQUIRED' USING ERRCODE='42501'; END IF;
 IF EXISTS (SELECT 1 FROM warehouse_identity.password_recovery_stepup_uses_v62
   WHERE evidence_id=p_step_up_evidence_id) THEN
  RAISE EXCEPTION 'STEP_UP_EVIDENCE_ALREADY_USED' USING ERRCODE='42501';
 END IF;
 -- Exceptions are only valid if the 24h limit would actually block the target.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_target_user_id::text,6202));
 IF NOT EXISTS (
  SELECT 1 FROM warehouse_identity.password_reset_requests r
  WHERE r.user_id=p_target_user_id AND r.request_type='SELF_SERVICE'
    AND r.created_at>clock_timestamp()-interval '24 hours'
 ) THEN RAISE EXCEPTION 'OVERRIDE_NOT_REQUIRED' USING ERRCODE='23514'; END IF;
 IF EXISTS (
  SELECT 1 FROM warehouse_identity.password_recovery_overrides_v62 o
  WHERE o.target_user_id=p_target_user_id AND o.revoked_at IS NULL
    AND o.consumed_at IS NULL AND o.expires_at>clock_timestamp()
 ) THEN RAISE EXCEPTION 'ACTIVE_OVERRIDE_ALREADY_EXISTS' USING ERRCODE='23505'; END IF;
 INSERT INTO warehouse_identity.password_recovery_stepup_uses_v62(evidence_id,actor_user_id,action,target_user_id,request_id)
 VALUES(p_step_up_evidence_id,a.user_id,'OVERRIDE',p_target_user_id,p_request_id);
 INSERT INTO warehouse_identity.password_recovery_overrides_v62
 (target_user_id,target_facility_id,authorized_by,authorized_session_id,assurance_evidence_id,reason_code,justification,created_at,expires_at,request_id,correlation_id)
 VALUES(p_target_user_id,v_facility,a.user_id,p_manager_auth_session_id,p_step_up_evidence_id,p_reason_code,p_justification,v_now,v_now+interval '30 minutes',p_request_id,p_correlation_id)
 RETURNING override_id INTO v_authorized;
 INSERT INTO warehouse_audit.security_events(event_type,severity,actor_user_id,entity_type,entity_id,request_id,correlation_id,facility_id,auth_session_id,details)
 VALUES('PASSWORD_RECOVERY_OVERRIDE_AUTHORIZED',60,a.user_id,'PASSWORD_RECOVERY_OVERRIDE',v_authorized,p_request_id,p_correlation_id,v_facility,p_manager_auth_session_id,jsonb_build_object('target_user_id',p_target_user_id,'reason_code',p_reason_code,'expires_at',v_now+interval '30 minutes'));
 RETURN v_authorized;
END $fn$;

-- Called by a privileged backend adapter only. Unknown identifiers must be resolved
-- without enumeration by the HTTP layer; NULL target returns NULL without creating records.
CREATE OR REPLACE FUNCTION warehouse_identity.request_password_recovery_v62(
 p_target_user_id uuid,p_reason_code text,p_reason text,p_override_id uuid,
 p_request_id uuid,p_correlation_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog','warehouse_identity' AS $fn$
DECLARE v_facility uuid; v_now timestamptz; v_new uuid; v_override warehouse_identity.password_recovery_overrides_v62;
BEGIN
 IF p_request_id IS NULL OR p_correlation_id IS NULL OR
    length(btrim(coalesce(p_reason_code,''))) NOT BETWEEN 3 AND 80 OR
    length(coalesce(p_reason,''))>1000 THEN
  RAISE EXCEPTION 'INVALID_RECOVERY_REQUEST' USING ERRCODE='22023';
 END IF;
 IF p_target_user_id IS NULL THEN RETURN NULL; END IF;
 -- Serializes all requests for the same target, even before a first request exists.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_target_user_id::text,6202));
 v_now:=clock_timestamp();
 SELECT e.facility_id INTO v_facility FROM warehouse_identity.employees e
 JOIN warehouse_identity.users u ON u.user_id=e.user_id
 WHERE e.user_id=p_target_user_id AND e.employment_status='ACTIVE' AND u.status='ACTIVE';
 IF v_facility IS NULL THEN RETURN NULL; END IF;
 -- Duplicate client retries must never produce additional records.
 IF EXISTS(SELECT 1 FROM warehouse_identity.password_reset_requests
           WHERE request_id=p_request_id) THEN
   RAISE EXCEPTION 'RECOVERY_DUPLICATE_REQUEST_ID' USING ERRCODE='23505';
 END IF;
 IF EXISTS (SELECT 1 FROM warehouse_identity.password_reset_requests r
   WHERE r.user_id=p_target_user_id AND r.request_type='SELF_SERVICE' AND r.created_at>v_now-interval '24 hours') THEN
   IF p_override_id IS NULL THEN RAISE EXCEPTION 'RECOVERY_24H_LIMIT' USING ERRCODE='23514'; END IF;
   SELECT * INTO v_override FROM warehouse_identity.password_recovery_overrides_v62
    WHERE override_id=p_override_id FOR UPDATE;
   IF NOT FOUND OR v_override.target_user_id<>p_target_user_id OR v_override.target_facility_id<>v_facility
       OR v_override.consumed_at IS NOT NULL OR v_override.revoked_at IS NOT NULL OR v_override.expires_at<=v_now THEN
       RAISE EXCEPTION 'OVERRIDE_INVALID_OR_CONSUMED' USING ERRCODE='42501';
   END IF;
 ELSIF p_override_id IS NOT NULL THEN
   RAISE EXCEPTION 'OVERRIDE_NOT_REQUIRED' USING ERRCODE='22023';
 END IF;
 INSERT INTO warehouse_identity.password_reset_requests
 (user_id,request_type,status,reason_code,reason,request_id,correlation_id,created_at)
 VALUES(p_target_user_id,'SELF_SERVICE','REQUESTED',p_reason_code,p_reason,p_request_id,p_correlation_id,v_now)
 RETURNING password_reset_request_id INTO v_new;
 IF p_override_id IS NOT NULL THEN
   UPDATE warehouse_identity.password_recovery_overrides_v62
    SET consumed_at=v_now,consumed_by_request_id=v_new,row_version=row_version+1 WHERE override_id=p_override_id;
 END IF;
 INSERT INTO warehouse_audit.security_events(event_type,severity,actor_user_id,entity_type,entity_id,request_id,correlation_id,facility_id,details)
 VALUES('PASSWORD_RECOVERY_REQUESTED',30,NULL,'PASSWORD_RESET_REQUEST',v_new,p_request_id,p_correlation_id,v_facility,
   jsonb_build_object('request_type','SELF_SERVICE','override_used',p_override_id IS NOT NULL));
 RETURN v_new;
END $fn$;

-- Harden the EXISTING approval authority in place: same signature and same status codes.
-- No credential writer is introduced; approved token hash remains passed by the 6.3 issuer.
CREATE OR REPLACE FUNCTION warehouse_identity.approve_password_reset_v3(
 p_approver_auth_session_id uuid,p_password_reset_request_id uuid,p_expected_row_version bigint,
 p_reset_token_hash bytea,p_expires_at timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog','warehouse_identity' AS $fn$
DECLARE a record; r warehouse_identity.password_reset_requests; v_facility uuid; v_now timestamptz :=clock_timestamp(); s record; v_evidence uuid;
BEGIN
 SELECT * INTO a FROM warehouse_identity.resolve_session_access(p_approver_auth_session_id,'warehouse:identity:password:reset_approve') LIMIT 1;
 IF NOT FOUND OR a.access_allowed IS DISTINCT FROM true OR a.assurance_level IS DISTINCT FROM 'AAL2' THEN RETURN 'APPROVER_NOT_AUTHORIZED'; END IF;
 SELECT user_id,device_id,revoked_at,idle_expires_at,absolute_expires_at INTO s FROM warehouse_identity.auth_sessions WHERE auth_session_id=p_approver_auth_session_id;
 IF NOT FOUND OR s.user_id IS DISTINCT FROM a.user_id OR s.revoked_at IS NOT NULL OR s.idle_expires_at<=v_now OR s.absolute_expires_at<=v_now THEN RETURN 'APPROVER_NOT_AUTHORIZED'; END IF;
 SELECT * INTO r FROM warehouse_identity.password_reset_requests WHERE password_reset_request_id=p_password_reset_request_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 IF r.row_version<>p_expected_row_version OR r.status<>'REQUESTED' THEN RETURN 'STALE_OR_INVALID_STATE'; END IF;
 IF r.requested_by=a.user_id OR r.user_id=a.user_id THEN RETURN 'SELF_APPROVAL_PROHIBITED'; END IF;
 SELECT facility_id INTO v_facility FROM warehouse_identity.employees WHERE user_id=r.user_id AND employment_status='ACTIVE';
 IF v_facility IS NULL OR NOT EXISTS(
  SELECT 1 FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.roles role ON role.role_id=ra.role_id
  WHERE ra.user_id=a.user_id AND ra.facility_id=v_facility AND ra.revoked_at IS NULL AND ra.valid_from<=v_now
   AND (ra.valid_until IS NULL OR ra.valid_until>v_now) AND role.active
   AND 'warehouse:identity:password:reset_approve'=ANY(role.permissions)
 ) THEN RETURN 'APPROVER_NOT_AUTHORIZED'; END IF;
 SELECT au.evidence_id INTO v_evidence
 FROM warehouse_identity.password_recovery_stepup_authorizations_v62 au
 JOIN warehouse_identity.webauthn_verification_evidence we
   ON we.webauthn_verification_evidence_id=au.evidence_id
 JOIN warehouse_identity.passkeys pk ON pk.passkey_id=we.passkey_id
 WHERE au.action='APPROVE' AND au.actor_user_id=a.user_id
   AND au.actor_session_id=p_approver_auth_session_id
   AND au.target_user_id=r.user_id AND au.target_reset_request_id=r.password_reset_request_id
   AND au.expires_at>v_now AND au.verified_at>=v_now-interval '5 minutes'
   AND we.user_id=a.user_id AND we.user_verified AND pk.user_id=a.user_id
   AND pk.enrolled_device_id=s.device_id AND pk.revoked_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM warehouse_identity.password_recovery_stepup_uses_v62 su
                  WHERE su.evidence_id=au.evidence_id)
 ORDER BY au.verified_at DESC LIMIT 1 FOR UPDATE OF au;
 IF v_evidence IS NULL THEN RETURN 'FRESH_STEP_UP_REQUIRED'; END IF;
 IF p_reset_token_hash IS NULL OR length(p_reset_token_hash)<>32 OR
  p_expires_at IS NULL OR p_expires_at<=v_now OR p_expires_at>v_now+interval '30 minutes' THEN RETURN 'INVALID_EXPIRY'; END IF;
 INSERT INTO warehouse_identity.password_recovery_stepup_uses_v62(evidence_id,actor_user_id,action,target_user_id,request_id)
 VALUES(v_evidence,a.user_id,'APPROVE',r.user_id,r.request_id);
 UPDATE warehouse_identity.password_reset_requests
 SET status='TOKEN_ISSUED',approved_by=a.user_id,approved_auth_session_id=p_approver_auth_session_id,
 token_hash=p_reset_token_hash,expires_at=p_expires_at,row_version=row_version+1
 WHERE password_reset_request_id=r.password_reset_request_id;
 INSERT INTO warehouse_audit.security_events(event_type,severity,actor_user_id,entity_type,entity_id,request_id,correlation_id,facility_id,auth_session_id,details)
 VALUES('PASSWORD_RECOVERY_APPROVED',60,a.user_id,'PASSWORD_RESET_REQUEST',r.password_reset_request_id,r.request_id,r.correlation_id,v_facility,p_approver_auth_session_id,jsonb_build_object('status','TOKEN_ISSUED'));
 RETURN 'APPROVED';
END $fn$;

-- Explicit execution isolation. Only approved backend database role may be granted EXECUTE.
-- All newly created objects are server-only. Runtime grants are a separate,
-- reviewed deployment decision. The verifier role must be distinct from the API role.
REVOKE ALL ON TABLE warehouse_identity.password_recovery_stepup_authorizations_v62 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION warehouse_identity.authorize_password_recovery_override_v62(uuid,uuid,uuid,text,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION warehouse_identity.request_password_recovery_v62(uuid,text,text,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION warehouse_identity.approve_password_reset_v3(uuid,uuid,bigint,bytea,timestamptz) FROM PUBLIC, anon, authenticated;
COMMIT;
