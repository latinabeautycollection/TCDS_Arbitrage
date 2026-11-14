-- CENTRAL IAM DB ONLY. After 623, before EOC production activation.
-- 90d hot / 365d database archive, with legal-hold override. Separate encrypted backup certification mandatory.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $$BEGIN
 IF to_regclass('warehouse_identity.eoc_bridge_audit_v12') IS NULL THEN RAISE EXCEPTION 'EOC625_REQUIRES_623'; END IF;
 IF to_regclass('warehouse_identity.eoc_bridge_audit_archive_v13') IS NOT NULL THEN RAISE EXCEPTION 'EOC625_ALREADY_INSTALLED'; END IF;
END$$;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_eoc_audit_retention_worker') THEN CREATE ROLE tcds_eoc_audit_retention_worker NOLOGIN; END IF;
END$$;
CREATE TABLE warehouse_identity.eoc_bridge_audit_archive_v13(
 audit_id bigint PRIMARY KEY,event_type text NOT NULL,subject_id uuid,request_id uuid,
 occurred_at timestamptz NOT NULL,archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 archive_digest text NOT NULL CHECK(archive_digest ~ '^[a-f0-9]{64}$')
);
CREATE INDEX eoc_bridge_audit_archive_time_v13 ON warehouse_identity.eoc_bridge_audit_archive_v13(occurred_at);
CREATE INDEX eoc_bridge_audit_time_v13 ON warehouse_identity.eoc_bridge_audit_v12(occurred_at);
CREATE TABLE warehouse_identity.eoc_bridge_legal_holds_v13(
 hold_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), audit_id bigint,
 subject_id uuid,reason_reference text NOT NULL CHECK(length(btrim(reason_reference))>=12),
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 released_at timestamptz,
 CHECK(audit_id IS NOT NULL OR subject_id IS NOT NULL)
);
CREATE INDEX eoc_bridge_holds_subject_v13 ON warehouse_identity.eoc_bridge_legal_holds_v13(subject_id) WHERE released_at IS NULL;
CREATE INDEX eoc_bridge_holds_audit_v13 ON warehouse_identity.eoc_bridge_legal_holds_v13(audit_id) WHERE released_at IS NULL;
CREATE FUNCTION warehouse_identity.eoc_bridge_hold_serial_lock_v13()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $lock$
BEGIN
  PERFORM pg_advisory_xact_lock(623,625);
  RETURN NEW;
END $lock$;
CREATE TRIGGER eoc_bridge_holds_serialize_v13 BEFORE INSERT OR UPDATE
 ON warehouse_identity.eoc_bridge_legal_holds_v13 FOR EACH ROW
 EXECUTE FUNCTION warehouse_identity.eoc_bridge_hold_serial_lock_v13();
REVOKE ALL ON FUNCTION warehouse_identity.eoc_bridge_hold_serial_lock_v13() FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE warehouse_identity.eoc_bridge_retention_runs_v13(
 run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hot_archived integer NOT NULL,
 hot_removed integer NOT NULL,archive_removed integer NOT NULL,
 ran_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(hot_archived>=0 AND hot_removed>=0 AND archive_removed>=0)
);
DO $$DECLARE n text;BEGIN FOREACH n IN ARRAY ARRAY['eoc_bridge_audit_archive_v13','eoc_bridge_legal_holds_v13','eoc_bridge_retention_runs_v13'] LOOP
 EXECUTE format('ALTER TABLE warehouse_identity.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('ALTER TABLE warehouse_identity.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('REVOKE ALL ON warehouse_identity.%I FROM PUBLIC,anon,authenticated,service_role',n);
 END LOOP;END$$;
GRANT USAGE ON SCHEMA warehouse_identity TO tcds_eoc_audit_retention_worker;
GRANT SELECT,INSERT,DELETE,UPDATE ON warehouse_identity.eoc_bridge_audit_archive_v13 TO tcds_identity_function_owner;
GRANT SELECT ON warehouse_identity.eoc_bridge_legal_holds_v13 TO tcds_identity_function_owner;
GRANT INSERT ON warehouse_identity.eoc_bridge_retention_runs_v13 TO tcds_identity_function_owner;
GRANT SELECT,DELETE,UPDATE ON warehouse_identity.eoc_bridge_audit_v12 TO tcds_identity_function_owner;
CREATE POLICY eoc625_archive_owner ON warehouse_identity.eoc_bridge_audit_archive_v13 FOR ALL TO tcds_identity_function_owner USING(true) WITH CHECK(true);
CREATE POLICY eoc625_holds_owner_read ON warehouse_identity.eoc_bridge_legal_holds_v13 FOR SELECT TO tcds_identity_function_owner USING(true);
CREATE POLICY eoc625_runs_owner_insert ON warehouse_identity.eoc_bridge_retention_runs_v13 FOR INSERT TO tcds_identity_function_owner WITH CHECK(true);
CREATE POLICY eoc625_audit_owner_read ON warehouse_identity.eoc_bridge_audit_v12 FOR SELECT TO tcds_identity_function_owner USING(true);
CREATE POLICY eoc625_audit_owner_delete ON warehouse_identity.eoc_bridge_audit_v12 FOR DELETE TO tcds_identity_function_owner USING(true);
CREATE POLICY eoc625_audit_owner_update_lock ON warehouse_identity.eoc_bridge_audit_v12 FOR UPDATE TO tcds_identity_function_owner USING(true) WITH CHECK(true);
-- Legal holds can only be managed by separately authorized compliance role; no EOC runtime privileges.
DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_eoc_legal_hold_admin') THEN CREATE ROLE tcds_eoc_legal_hold_admin NOLOGIN; END IF;END$$;
GRANT USAGE ON SCHEMA warehouse_identity TO tcds_eoc_legal_hold_admin;
GRANT EXECUTE ON FUNCTION warehouse_identity.eoc_bridge_hold_serial_lock_v13() TO tcds_eoc_legal_hold_admin;
GRANT SELECT,INSERT,UPDATE(released_at) ON warehouse_identity.eoc_bridge_legal_holds_v13 TO tcds_eoc_legal_hold_admin;
CREATE POLICY eoc625_holds_admin_read ON warehouse_identity.eoc_bridge_legal_holds_v13 FOR SELECT TO tcds_eoc_legal_hold_admin USING(true);
CREATE POLICY eoc625_holds_admin_insert ON warehouse_identity.eoc_bridge_legal_holds_v13 FOR INSERT TO tcds_eoc_legal_hold_admin WITH CHECK(released_at IS NULL);
CREATE POLICY eoc625_holds_admin_update ON warehouse_identity.eoc_bridge_legal_holds_v13 FOR UPDATE TO tcds_eoc_legal_hold_admin USING(released_at IS NULL) WITH CHECK(released_at IS NOT NULL);
-- Retention function ownership: adopt certified 623 temporary role-membership pattern.
CREATE TEMP TABLE eoc625_role_state ON COMMIT DROP AS SELECT
 EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member=current_user::regrole) AS had_member,
 (SELECT inherit_option FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member=current_user::regrole LIMIT 1) AS orig_inherit,
 (SELECT set_option FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member=current_user::regrole LIMIT 1) AS orig_set,
 pg_has_role(current_user,'tcds_identity_function_owner','SET') AS had_set;
DO $$BEGIN IF NOT (SELECT had_set FROM eoc625_role_state) THEN
 EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT TRUE, SET TRUE',current_user); END IF;END$$;
CREATE FUNCTION warehouse_identity.eoc_bridge_retention_batch_v13(p_limit integer DEFAULT 500)
RETURNS TABLE(archived integer,deleted_hot integer,deleted_archive integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE n_arch integer:=0;n_hot integer:=0;n_cold integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'RETENTION_BATCH_LIMIT_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(623,625);
 IF current_setting('tcds.eoc_archive_storage_certified',true) IS DISTINCT FROM 'YES' THEN RAISE EXCEPTION 'ARCHIVE_STORAGE_CERTIFICATION_REQUIRED' USING ERRCODE='42501'; END IF;
 WITH picked AS (
  SELECT a.audit_id,a.event_type,a.subject_id,a.request_id,a.occurred_at
  FROM warehouse_identity.eoc_bridge_audit_v12 a
  WHERE a.occurred_at < clock_timestamp()-interval '90 days'
    AND NOT EXISTS(SELECT 1 FROM warehouse_identity.eoc_bridge_legal_holds_v13 h
     WHERE h.released_at IS NULL AND (h.audit_id=a.audit_id OR (h.subject_id IS NOT NULL AND h.subject_id=a.subject_id)))
  ORDER BY a.audit_id LIMIT p_limit FOR UPDATE SKIP LOCKED
 ),stored AS (
  INSERT INTO warehouse_identity.eoc_bridge_audit_archive_v13(audit_id,event_type,subject_id,request_id,occurred_at,archive_digest)
  SELECT p.audit_id,p.event_type,p.subject_id,p.request_id,p.occurred_at,
   encode(sha256(convert_to(concat_ws('|',p.audit_id::text,p.event_type,coalesce(p.subject_id::text,''),coalesce(p.request_id::text,''),p.occurred_at::text),'UTF8')),'hex')
  FROM picked p ON CONFLICT(audit_id) DO NOTHING RETURNING audit_id
 ),removed AS (
  DELETE FROM warehouse_identity.eoc_bridge_audit_v12 a WHERE a.audit_id IN (SELECT audit_id FROM picked)
   AND (a.audit_id IN (SELECT audit_id FROM stored) OR EXISTS(SELECT 1 FROM warehouse_identity.eoc_bridge_audit_archive_v13 c WHERE c.audit_id=a.audit_id))
  RETURNING a.audit_id
 ) SELECT (SELECT count(*) FROM stored),(SELECT count(*) FROM removed) INTO n_arch,n_hot;
 WITH old_rows AS (
  SELECT a.audit_id FROM warehouse_identity.eoc_bridge_audit_archive_v13 a
  WHERE current_setting('tcds.eoc_archive_purge_certified',true)='YES' AND a.occurred_at < clock_timestamp()-interval '365 days'
   AND NOT EXISTS(SELECT 1 FROM warehouse_identity.eoc_bridge_legal_holds_v13 h
    WHERE h.released_at IS NULL AND (h.audit_id=a.audit_id OR (h.subject_id IS NOT NULL AND h.subject_id=a.subject_id)))
  ORDER BY a.audit_id LIMIT p_limit FOR UPDATE SKIP LOCKED
 ),removed AS (
  DELETE FROM warehouse_identity.eoc_bridge_audit_archive_v13 a WHERE a.audit_id IN (SELECT audit_id FROM old_rows)
  RETURNING a.audit_id
 ) SELECT count(*) INTO n_cold FROM removed;
 INSERT INTO warehouse_identity.eoc_bridge_retention_runs_v13(hot_archived,hot_removed,archive_removed) VALUES(n_arch,n_hot,n_cold);
 RETURN QUERY SELECT n_arch,n_hot,n_cold;
END $fn$;
ALTER FUNCTION warehouse_identity.eoc_bridge_retention_batch_v13(integer) OWNER TO tcds_identity_function_owner;
REVOKE ALL ON FUNCTION warehouse_identity.eoc_bridge_retention_batch_v13(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION warehouse_identity.eoc_bridge_retention_batch_v13(integer) TO tcds_eoc_audit_retention_worker;
DO $$BEGIN
 IF NOT (SELECT had_member FROM eoc625_role_state) THEN EXECUTE format('REVOKE tcds_identity_function_owner FROM %I',current_user);
 ELSIF NOT (SELECT had_set FROM eoc625_role_state) THEN
  EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT %s, SET %s',current_user,
   CASE WHEN (SELECT orig_inherit FROM eoc625_role_state) THEN 'TRUE' ELSE 'FALSE' END,
   CASE WHEN (SELECT orig_set FROM eoc625_role_state) THEN 'TRUE' ELSE 'FALSE' END);
 END IF;END$$;
COMMIT;
