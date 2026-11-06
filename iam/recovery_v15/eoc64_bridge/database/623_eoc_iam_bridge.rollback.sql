-- 623 rollback: removes exactly what 623 added. Run BEFORE 622's rollback.
-- Refuses if any federated subject binding exists (that is identity data; reconcile it first).
-- Nonce and audit rows are dropped with their tables (staging only - keep the audit in production).
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
 IF to_regprocedure('warehouse_identity.eoc_bridge_ready_v623(uuid)') IS NULL THEN RAISE EXCEPTION 'R623_NOT_INSTALLED'; END IF;
 IF EXISTS (SELECT 1 FROM warehouse_identity.eoc_federated_subject_bindings_v12) THEN RAISE EXCEPTION 'R623_BINDINGS_PRESENT_RECONCILE_FIRST'; END IF;
END $preflight$;

CREATE TEMP TABLE r623_rb ON COMMIT DROP AS
SELECT NOT pg_has_role('postgres','tcds_identity_function_owner','USAGE') AS need,
       (SELECT inherit_option FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole) AS m_inherit,
       (SELECT set_option FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole) AS m_set,
       EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole) AS had,
       coalesce(obj_description('warehouse_identity.eoc_bridge_ready_v623(uuid)'::regprocedure, 'pg_proc'), '')
         = 'r623 granted_org_usage=true' AS revoke_org_usage;
DO $up$ BEGIN
 IF (SELECT need FROM r623_rb) THEN EXECUTE 'GRANT tcds_identity_function_owner TO postgres WITH INHERIT TRUE, SET FALSE'; END IF;
END $up$;

DROP FUNCTION warehouse_identity.eoc_bridge_admit_nonce_v623(text);
DROP FUNCTION warehouse_identity.eoc_bridge_ready_v623(uuid);
DROP FUNCTION warehouse_identity.eoc_subject_snapshot_v623(uuid,uuid);
DROP FUNCTION warehouse_identity.eoc_resolve_federation_v623(text,text,uuid);

DROP POLICY eoc623_fn_read ON enterprise_org.leadership_people;
DROP POLICY eoc623_fn_read ON enterprise_org.leadership_appointments;
DROP POLICY eoc623_fn_read ON enterprise_org.positions;
REVOKE SELECT (person_id,iam_user_id,record_status,iam_link_verified_at,iam_link_authority,iam_link_evidence_reference,row_version)
  ON enterprise_org.leadership_people FROM tcds_identity_function_owner;
REVOKE SELECT (appointment_id,person_id,position_code,appointment_status,approved_at,approval_reference,effective_from,effective_until,row_version)
  ON enterprise_org.leadership_appointments FROM tcds_identity_function_owner;
REVOKE SELECT (position_code,active) ON enterprise_org.positions FROM tcds_identity_function_owner;

DROP TABLE warehouse_identity.eoc_bridge_audit_v12;
DROP TABLE warehouse_identity.eoc_bridge_nonces_v12;
DROP TABLE warehouse_identity.eoc_federated_subject_bindings_v12;

DO $down$ BEGIN
 IF (SELECT revoke_org_usage FROM r623_rb) THEN EXECUTE 'REVOKE USAGE ON SCHEMA enterprise_org FROM tcds_identity_function_owner'; END IF;
 IF (SELECT need FROM r623_rb) THEN
  IF (SELECT had FROM r623_rb) THEN
   EXECUTE format('GRANT tcds_identity_function_owner TO postgres WITH INHERIT %s, SET %s',
                  (SELECT m_inherit FROM r623_rb)::text, (SELECT m_set FROM r623_rb)::text);
  ELSE EXECUTE 'REVOKE tcds_identity_function_owner FROM postgres'; END IF;
 END IF;
END $down$;

DO $verify$ BEGIN
 IF to_regclass('warehouse_identity.eoc_bridge_nonces_v12') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'eoc\_%\_v623')
 OR EXISTS (SELECT 1 FROM pg_policies WHERE policyname LIKE 'eoc623\_%')
 OR EXISTS (SELECT 1 FROM information_schema.column_privileges WHERE grantee='tcds_identity_function_owner' AND table_schema='enterprise_org')
 THEN RAISE EXCEPTION 'R623_ROLLBACK_INCOMPLETE'; END IF;
END $verify$;
COMMIT;
