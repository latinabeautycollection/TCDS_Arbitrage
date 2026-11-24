-- 623 - ours (TCDS production engineering), on top of V1.5 + 620 + 621 + 622. Staging first.
-- Corrected replacement for the IAM-side SQL of Anthony's EOC 6.4 V1.2 (server/iam-bridge/067 + 070). Same three
-- tables and the same JSON contract his EOC authorityClient expects; the bridge itself runs inside login-v2-api's
-- private internal IAM listener (internalIamApi.ts), so it uses login-v2-api's tcds_login_api pool and no separate
-- iam_eoc_bridge_reader login / iam_eoc_bridge_fn_owner role is created. Fixes against 070:
--   1. status and epoch come from iam_session_epoch_status_v15 (622): a user with no epoch row reads as epoch 0
--      (070's INNER JOIN made every user without a reset/revocation event an UNKNOWN_SUBJECT), a failed-login
--      lockout does NOT end EOC sessions (070 treated LOCKED / locked_until as inactive), and an employee row that is
--      not ACTIVE reads as inactive (070 ignored employment).
--   2. functions are owned by tcds_identity_function_owner via the same temporary-membership step as 620-622
--      (070's ALTER OWNER TO a freshly created role fails on Supabase PG17: postgres gets ADMIN but not SET).
--   3. nonce admission, audit and the identity read are each ONE security-definer call; expired nonces are deleted
--      on admission (070 never pruned), and tcds_login_api gets EXECUTE only - no table grants.
-- Run 623's rollback BEFORE 622's.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
 IF to_regprocedure('warehouse_identity.iam_sign_out_everywhere_v15(bytea,uuid,uuid)') IS NULL
 OR to_regprocedure('warehouse_identity.iam_session_epoch_status_v15(uuid)') IS NULL
 THEN RAISE EXCEPTION 'R623_622_NOT_INSTALLED'; END IF;
 IF to_regclass('enterprise_org.leadership_people') IS NULL OR to_regclass('enterprise_org.leadership_appointments') IS NULL
 OR to_regclass('enterprise_org.positions') IS NULL THEN RAISE EXCEPTION 'R623_LEADERSHIP_SCHEMA_MISSING'; END IF;
 IF to_regclass('warehouse_identity.eoc_federated_subject_bindings_v12') IS NOT NULL
 OR to_regclass('warehouse_identity.eoc_bridge_nonces_v12') IS NOT NULL
 OR to_regclass('warehouse_identity.eoc_bridge_audit_v12') IS NOT NULL
 THEN RAISE EXCEPTION 'R623_ALREADY_INSTALLED_OR_070_PRESENT'; END IF;
 -- the rollback revokes the leadership column grants below, so none may exist beforehand
 IF EXISTS (SELECT 1 FROM information_schema.column_privileges WHERE grantee='tcds_identity_function_owner'
             AND table_schema='enterprise_org')
 OR has_table_privilege('tcds_identity_function_owner','enterprise_org.leadership_people','SELECT')
 OR has_table_privilege('tcds_identity_function_owner','enterprise_org.leadership_appointments','SELECT')
 OR has_table_privilege('tcds_identity_function_owner','enterprise_org.positions','SELECT')
 THEN RAISE EXCEPTION 'R623_FN_OWNER_ALREADY_HAS_LEADERSHIP_GRANTS_RECONCILE'; END IF;
END $preflight$;

-- Temporarily let postgres act as the function owner; restored below.
CREATE TEMP TABLE r623_m ON COMMIT DROP AS
SELECT NOT pg_has_role('postgres','tcds_identity_function_owner','USAGE') OR NOT pg_has_role('postgres','tcds_identity_function_owner','SET') AS need,
       (SELECT inherit_option FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole) AS m_inherit,
       (SELECT set_option FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole) AS m_set,
       EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole) AS had,
       has_schema_privilege('tcds_identity_function_owner','warehouse_identity','CREATE') AS had_create,
       has_schema_privilege('tcds_identity_function_owner','enterprise_org','USAGE') AS had_org_usage;
DO $up$ BEGIN
 IF (SELECT need FROM r623_m) THEN EXECUTE 'GRANT tcds_identity_function_owner TO postgres WITH INHERIT TRUE, SET TRUE'; END IF;
 IF NOT (SELECT had_create FROM r623_m) THEN EXECUTE 'GRANT CREATE ON SCHEMA warehouse_identity TO tcds_identity_function_owner'; END IF;
 IF NOT (SELECT had_org_usage FROM r623_m) THEN EXECUTE 'GRANT USAGE ON SCHEMA enterprise_org TO tcds_identity_function_owner'; END IF;
END $up$;

-- (a) tables: Anthony's 070 definitions, unchanged apart from the nonce expiry index and the audit event list.
CREATE TABLE warehouse_identity.eoc_federated_subject_bindings_v12 (
 binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issuer text NOT NULL CHECK (issuer LIKE 'https://%'),
 subject_hash text NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 binding_status text NOT NULL DEFAULT 'PENDING' CHECK (binding_status IN ('PENDING','VERIFIED','REVOKED')),
 evidence_reference text, approved_by uuid, secondary_approved_by uuid, verified_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (issuer, subject_hash), UNIQUE (issuer, user_id),
 CONSTRAINT verified_binding_requires_evidence CHECK (binding_status <> 'VERIFIED' OR (nullif(btrim(evidence_reference),'') IS NOT NULL
   AND approved_by IS NOT NULL AND secondary_approved_by IS NOT NULL AND approved_by <> secondary_approved_by
   AND approved_by <> user_id AND secondary_approved_by <> user_id AND verified_at IS NOT NULL AND revoked_at IS NULL))
);
CREATE TABLE warehouse_identity.eoc_bridge_nonces_v12 (
 nonce_hash text PRIMARY KEY CHECK (nonce_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX eoc_bridge_nonces_v12_expires_idx ON warehouse_identity.eoc_bridge_nonces_v12 (expires_at);
CREATE TABLE warehouse_identity.eoc_bridge_audit_v12 (
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_type text NOT NULL CHECK (event_type IN ('EOC_BRIDGE_HEALTH','EOC_SUBJECT_CHECK','EOC_SUBJECT_UNKNOWN',
   'EOC_FEDERATION_RESOLVED','EOC_FEDERATION_DENIED')),
 subject_id uuid, request_id uuid, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());

ALTER TABLE warehouse_identity.eoc_federated_subject_bindings_v12 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.eoc_federated_subject_bindings_v12 FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.eoc_bridge_nonces_v12 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.eoc_bridge_nonces_v12 FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.eoc_bridge_audit_v12 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.eoc_bridge_audit_v12 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.eoc_federated_subject_bindings_v12, warehouse_identity.eoc_bridge_nonces_v12,
  warehouse_identity.eoc_bridge_audit_v12 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE warehouse_identity.eoc_bridge_audit_v12_audit_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON warehouse_identity.eoc_federated_subject_bindings_v12 TO tcds_identity_function_owner;
GRANT SELECT, INSERT, DELETE ON warehouse_identity.eoc_bridge_nonces_v12 TO tcds_identity_function_owner;
GRANT INSERT ON warehouse_identity.eoc_bridge_audit_v12 TO tcds_identity_function_owner;
GRANT USAGE ON SEQUENCE warehouse_identity.eoc_bridge_audit_v12_audit_id_seq TO tcds_identity_function_owner;
CREATE POLICY eoc623_fn_binding_read ON warehouse_identity.eoc_federated_subject_bindings_v12
  FOR SELECT TO tcds_identity_function_owner USING (true);
CREATE POLICY eoc623_fn_nonce ON warehouse_identity.eoc_bridge_nonces_v12
  FOR ALL TO tcds_identity_function_owner USING (true) WITH CHECK (expires_at <= clock_timestamp() + interval '3 minutes');
CREATE POLICY eoc623_fn_audit ON warehouse_identity.eoc_bridge_audit_v12
  FOR INSERT TO tcds_identity_function_owner WITH CHECK (true);

-- (b) leadership read for the snapshot: the exact columns 070 used, to the function owner only.
GRANT SELECT (person_id,iam_user_id,record_status,iam_link_verified_at,iam_link_authority,iam_link_evidence_reference,row_version)
  ON enterprise_org.leadership_people TO tcds_identity_function_owner;
GRANT SELECT (appointment_id,person_id,position_code,appointment_status,approved_at,approval_reference,effective_from,effective_until,row_version)
  ON enterprise_org.leadership_appointments TO tcds_identity_function_owner;
GRANT SELECT (position_code,active) ON enterprise_org.positions TO tcds_identity_function_owner;
CREATE POLICY eoc623_fn_read ON enterprise_org.leadership_people FOR SELECT TO tcds_identity_function_owner USING (true);
CREATE POLICY eoc623_fn_read ON enterprise_org.leadership_appointments FOR SELECT TO tcds_identity_function_owner USING (true);
CREATE POLICY eoc623_fn_read ON enterprise_org.positions FOR SELECT TO tcds_identity_function_owner USING (true);

-- (c) the four bridge operations.
CREATE FUNCTION warehouse_identity.eoc_bridge_admit_nonce_v623(p_nonce_hash text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
 IF p_nonce_hash IS NULL OR p_nonce_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 DELETE FROM warehouse_identity.eoc_bridge_nonces_v12 WHERE expires_at < clock_timestamp();
 INSERT INTO warehouse_identity.eoc_bridge_nonces_v12 (nonce_hash, expires_at)
 VALUES (p_nonce_hash, clock_timestamp() + interval '2 minutes') ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $fn$;

CREATE FUNCTION warehouse_identity.eoc_bridge_ready_v623(p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
 INSERT INTO warehouse_identity.eoc_bridge_audit_v12 (event_type, request_id) VALUES ('EOC_BRIDGE_HEALTH', p_request_id);
 RETURN true;
END $fn$;

-- Same JSON shape as 070's eoc_subject_snapshot_v12 (EOC authorityClient.verifySubject); NULL = unknown user.
CREATE FUNCTION warehouse_identity.eoc_subject_snapshot_v623(p_user_id uuid, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE s record; out jsonb;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM warehouse_identity.users WHERE user_id = p_user_id) THEN
  INSERT INTO warehouse_identity.eoc_bridge_audit_v12 (event_type, request_id) VALUES ('EOC_SUBJECT_UNKNOWN', p_request_id);
  RETURN NULL;
 END IF;
 SELECT * INTO s FROM warehouse_identity.iam_session_epoch_status_v15(p_user_id);
 out := jsonb_build_object('userId', p_user_id, 'active', s.user_active IS TRUE, 'epoch', s.epoch,
  'appointments', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'iam_user_id',p.iam_user_id,'record_status',p.record_status,'iam_link_verified_at',p.iam_link_verified_at,
    'iam_link_authority',p.iam_link_authority,'iam_link_evidence_reference',p.iam_link_evidence_reference,
    'person_row_version',p.row_version,'appointment_row_version',a.row_version,'appointment_id',a.appointment_id,
    'appointment_status',a.appointment_status,'approved_at',a.approved_at,'approval_reference',a.approval_reference,
    'effective_from',a.effective_from,'effective_until',a.effective_until,'position_code',a.position_code,
    'position_active',pos.active) ORDER BY a.appointment_id)
   FROM enterprise_org.leadership_people p
   JOIN enterprise_org.leadership_appointments a ON a.person_id = p.person_id
   JOIN enterprise_org.positions pos ON pos.position_code = a.position_code
   WHERE p.iam_user_id = p_user_id), '[]'::jsonb));
 INSERT INTO warehouse_identity.eoc_bridge_audit_v12 (event_type, subject_id, request_id) VALUES ('EOC_SUBJECT_CHECK', p_user_id, p_request_id);
 RETURN out;
END $fn$;

CREATE FUNCTION warehouse_identity.eoc_resolve_federation_v623(p_issuer text, p_subject_hash text, p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE u uuid;
BEGIN
 SELECT f.user_id INTO u FROM warehouse_identity.eoc_federated_subject_bindings_v12 f
  WHERE f.issuer = p_issuer AND f.subject_hash = p_subject_hash AND f.binding_status = 'VERIFIED' AND f.revoked_at IS NULL
    AND (SELECT s.user_active FROM warehouse_identity.iam_session_epoch_status_v15(f.user_id) s) IS TRUE;
 INSERT INTO warehouse_identity.eoc_bridge_audit_v12 (event_type, subject_id, request_id)
 VALUES (CASE WHEN u IS NULL THEN 'EOC_FEDERATION_DENIED' ELSE 'EOC_FEDERATION_RESOLVED' END, u, p_request_id);
 RETURN u;
END $fn$;

REVOKE ALL ON FUNCTION warehouse_identity.eoc_bridge_admit_nonce_v623(text), warehouse_identity.eoc_bridge_ready_v623(uuid),
  warehouse_identity.eoc_subject_snapshot_v623(uuid,uuid), warehouse_identity.eoc_resolve_federation_v623(text,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION warehouse_identity.eoc_bridge_admit_nonce_v623(text), warehouse_identity.eoc_bridge_ready_v623(uuid),
  warehouse_identity.eoc_subject_snapshot_v623(uuid,uuid), warehouse_identity.eoc_resolve_federation_v623(text,text,uuid)
  TO tcds_login_api;
ALTER FUNCTION warehouse_identity.eoc_bridge_admit_nonce_v623(text) OWNER TO tcds_identity_function_owner;
ALTER FUNCTION warehouse_identity.eoc_bridge_ready_v623(uuid) OWNER TO tcds_identity_function_owner;
ALTER FUNCTION warehouse_identity.eoc_subject_snapshot_v623(uuid,uuid) OWNER TO tcds_identity_function_owner;
ALTER FUNCTION warehouse_identity.eoc_resolve_federation_v623(text,text,uuid) OWNER TO tcds_identity_function_owner;
-- the rollback reads this to know whether it must take back USAGE on enterprise_org
DO $c$ BEGIN
 EXECUTE format('COMMENT ON FUNCTION warehouse_identity.eoc_bridge_ready_v623(uuid) IS %L',
   'r623 granted_org_usage=' || (NOT (SELECT had_org_usage FROM r623_m))::text);
END $c$;

DO $down$ BEGIN
 IF NOT (SELECT had_create FROM r623_m) THEN EXECUTE 'REVOKE CREATE ON SCHEMA warehouse_identity FROM tcds_identity_function_owner'; END IF;
 IF (SELECT need FROM r623_m) THEN
  IF (SELECT had FROM r623_m) THEN
   EXECUTE format('GRANT tcds_identity_function_owner TO postgres WITH INHERIT %s, SET %s',
                  (SELECT m_inherit FROM r623_m)::text, (SELECT m_set FROM r623_m)::text);
  ELSE EXECUTE 'REVOKE tcds_identity_function_owner FROM postgres'; END IF;
 END IF;
END $down$;

DO $verify$
DECLARE f regprocedure;
BEGIN
 FOREACH f IN ARRAY ARRAY['warehouse_identity.eoc_bridge_admit_nonce_v623(text)'::regprocedure,
   'warehouse_identity.eoc_bridge_ready_v623(uuid)'::regprocedure,
   'warehouse_identity.eoc_subject_snapshot_v623(uuid,uuid)'::regprocedure,
   'warehouse_identity.eoc_resolve_federation_v623(text,text,uuid)'::regprocedure] LOOP
  IF (SELECT pg_get_userbyid(proowner) <> 'tcds_identity_function_owner' OR NOT prosecdef FROM pg_proc WHERE oid = f)
   THEN RAISE EXCEPTION 'R623_OWNER_OR_DEFINER_WRONG %', f; END IF;
  IF has_function_privilege('public', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
     OR has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('service_role', f, 'EXECUTE')
   THEN RAISE EXCEPTION 'R623_EXECUTE_TOO_BROAD %', f; END IF;
  IF NOT has_function_privilege('tcds_login_api', f, 'EXECUTE') THEN RAISE EXCEPTION 'R623_LOGIN_API_CANNOT_EXECUTE %', f; END IF;
 END LOOP;
 IF has_table_privilege('tcds_login_api','warehouse_identity.eoc_federated_subject_bindings_v12','SELECT')
 OR has_table_privilege('tcds_login_api','warehouse_identity.eoc_bridge_nonces_v12','INSERT')
 OR has_table_privilege('anon','warehouse_identity.eoc_bridge_audit_v12','SELECT')
 OR has_table_privilege('authenticated','warehouse_identity.eoc_federated_subject_bindings_v12','SELECT')
 THEN RAISE EXCEPTION 'R623_TABLE_GRANTS_TOO_BROAD'; END IF;
END $verify$;
COMMIT;
