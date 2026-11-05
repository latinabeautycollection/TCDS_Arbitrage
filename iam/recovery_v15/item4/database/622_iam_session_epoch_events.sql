-- 622 - ours (TCDS production engineering), on top of V1.5 + 620 + 621. Staging first.
-- Anthony decision 4: every IAM event that must end EOC sessions advances iam_session_epochs_v15 IN THE SAME TRANSACTION
-- as the change itself. Database triggers are used because nothing in 6.1B changes user or employment status today
-- (only postgres / tcds_identity_function_owner can write those tables), so any path - admin tool, HR offboarding,
-- a manual SQL fix - is covered.
--   users       status ACTIVE/LOCKED -> SUSPENDED|DISABLED|ARCHIVED, or archived_at set          -> IDENTITY_SUSPENDED
--   employees   employment_status ACTIVE -> LEAVE|SUSPENDED|TERMINATED                            -> IDENTITY_SUSPENDED
--   passkeys    security_state -> SUSPENDED|RECOVERY|REVOKED, or revoked_at set                   -> PASSKEY_REVOKED
--   session_revocation_commands  COMPLETED with scope USER | FACILITY | ALL (the existing v3 path) -> GLOBAL_REVOCATION
--   iam_sign_out_everywhere_v15(token_hash,...)  new: the caller's own "sign out everywhere"         -> SIGN_OUT_EVERYWHERE
-- Deliberately NOT an epoch event: LOCKED (failed-login lockout - an attacker could otherwise log the real user out of
-- EOC by guessing passwords) and an ordinary single-device logout.
-- iam_session_epoch_status_v15 is replaced to match: LOCKED / locked_until no longer reads as inactive, and an
-- employee row that is not ACTIVE now reads as inactive.
-- Run 622's rollback BEFORE 621's and 620's rollbacks.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
 IF to_regprocedure('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)') IS NULL
 OR to_regprocedure('warehouse_identity.iam_advance_session_epoch_v15(uuid,text,uuid,uuid,uuid)') IS NULL
 THEN RAISE EXCEPTION 'R622_620_621_NOT_INSTALLED'; END IF;
 IF to_regprocedure('warehouse_identity.iam_sign_out_everywhere_v15(bytea,uuid,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'R622_ALREADY_INSTALLED'; END IF;
 IF to_regclass('warehouse_identity.session_revocation_commands') IS NULL THEN RAISE EXCEPTION 'R622_COMMANDS_TABLE_MISSING'; END IF;
END $preflight$;

-- Temporarily let postgres act as the function owner (replace an owned function, hand ownership over); restored below.
CREATE TEMP TABLE r622_m ON COMMIT DROP AS
SELECT NOT pg_has_role('postgres','tcds_identity_function_owner','USAGE') OR NOT pg_has_role('postgres','tcds_identity_function_owner','SET') AS need,
       (SELECT inherit_option FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole) AS m_inherit,
       (SELECT set_option FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole) AS m_set,
       EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole) AS had,
       has_schema_privilege('tcds_identity_function_owner','warehouse_identity','CREATE') AS had_create;
DO $up$ BEGIN
 IF (SELECT need FROM r622_m) THEN EXECUTE 'GRANT tcds_identity_function_owner TO postgres WITH INHERIT TRUE, SET TRUE'; END IF;
 IF NOT (SELECT had_create FROM r622_m) THEN EXECUTE 'GRANT CREATE ON SCHEMA warehouse_identity TO tcds_identity_function_owner'; END IF;
END $up$;

-- (a) status for the EOC verification API (owner, grants and signature unchanged).
CREATE OR REPLACE FUNCTION warehouse_identity.iam_session_epoch_status_v15(p_user_id uuid)
RETURNS TABLE (user_active boolean, epoch bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
 SELECT coalesce((SELECT u.status IN ('ACTIVE','LOCKED') AND u.archived_at IS NULL
                          AND NOT EXISTS (SELECT 1 FROM warehouse_identity.employees e
                                          WHERE e.user_id = u.user_id AND e.employment_status <> 'ACTIVE')
                   FROM warehouse_identity.users u WHERE u.user_id = p_user_id), false),
        coalesce((SELECT e.epoch FROM warehouse_identity.iam_session_epochs_v15 e WHERE e.user_id = p_user_id), 0);
$fn$;

-- (b) one trigger function for all four tables. Runs in the writer's transaction; any failure aborts the change.
CREATE FUNCTION warehouse_identity.iam_epoch_event_trigger_v15()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE u uuid;
BEGIN
 IF TG_TABLE_NAME = 'users' THEN
  IF (NEW.status IN ('SUSPENDED','DISABLED','ARCHIVED') AND OLD.status IS DISTINCT FROM NEW.status)
     OR (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL) THEN
   PERFORM warehouse_identity.iam_advance_session_epoch_v15(NEW.user_id, 'IDENTITY_SUSPENDED', gen_random_uuid(), NULL, NULL);
  END IF;
 ELSIF TG_TABLE_NAME = 'employees' THEN
  IF OLD.employment_status = 'ACTIVE' AND NEW.employment_status <> 'ACTIVE' THEN
   PERFORM warehouse_identity.iam_advance_session_epoch_v15(NEW.user_id, 'IDENTITY_SUSPENDED', gen_random_uuid(), NULL, NULL);
  END IF;
 ELSIF TG_TABLE_NAME = 'passkeys' THEN
  IF (NEW.security_state IN ('SUSPENDED','RECOVERY','REVOKED') AND OLD.security_state IS DISTINCT FROM NEW.security_state)
     OR (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL) THEN
   PERFORM warehouse_identity.iam_advance_session_epoch_v15(NEW.user_id, 'PASSKEY_REVOKED', gen_random_uuid(), NULL, NEW.revoked_by);
  END IF;
 ELSIF TG_TABLE_NAME = 'session_revocation_commands' THEN
  IF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED' AND NEW.scope_type IN ('USER','FACILITY','ALL') THEN
   FOR u IN
    SELECT x.user_id FROM warehouse_identity.users x
     WHERE x.archived_at IS NULL
       AND (NEW.scope_type = 'ALL'
         OR (NEW.scope_type = 'USER' AND x.user_id = NEW.scope_id)
         OR (NEW.scope_type = 'FACILITY' AND EXISTS (SELECT 1 FROM warehouse_identity.employees e
                                                      WHERE e.user_id = x.user_id AND e.facility_id = NEW.scope_id)))
     ORDER BY x.user_id
   LOOP
    PERFORM warehouse_identity.iam_advance_session_epoch_v15(u, 'GLOBAL_REVOCATION',
      coalesce(NEW.request_id, gen_random_uuid()), NEW.correlation_id, NULL);
   END LOOP;
  END IF;
 END IF;
 RETURN NULL;
END $fn$;

CREATE TRIGGER trg_iam_epoch_v15_users AFTER UPDATE OF status, archived_at ON warehouse_identity.users
 FOR EACH ROW EXECUTE FUNCTION warehouse_identity.iam_epoch_event_trigger_v15();
CREATE TRIGGER trg_iam_epoch_v15_employees AFTER UPDATE OF employment_status ON warehouse_identity.employees
 FOR EACH ROW EXECUTE FUNCTION warehouse_identity.iam_epoch_event_trigger_v15();
CREATE TRIGGER trg_iam_epoch_v15_passkeys AFTER UPDATE OF security_state, revoked_at ON warehouse_identity.passkeys
 FOR EACH ROW EXECUTE FUNCTION warehouse_identity.iam_epoch_event_trigger_v15();
CREATE TRIGGER trg_iam_epoch_v15_revocation_commands AFTER UPDATE OF status ON warehouse_identity.session_revocation_commands
 FOR EACH ROW EXECUTE FUNCTION warehouse_identity.iam_epoch_event_trigger_v15();

-- (c) the caller's own "sign out everywhere": every active Warehouse session of the session's user + the epoch.
-- Lock order: sessions, then the epoch row (same as v5: sessions are locked before anything epoch-related).
CREATE FUNCTION warehouse_identity.iam_sign_out_everywhere_v15(p_token_hash bytea, p_request_id uuid, p_correlation_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE s warehouse_identity.auth_sessions%ROWTYPE; r record; n integer := 0;
BEGIN
 IF p_token_hash IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = '28000'; END IF;
 SELECT * INTO s FROM warehouse_identity.auth_sessions
  WHERE token_hash = p_token_hash AND revoked_at IS NULL
    AND idle_expires_at > clock_timestamp() AND absolute_expires_at > clock_timestamp()
  FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = '28000'; END IF;
 FOR r IN SELECT auth_session_id FROM warehouse_identity.auth_sessions
           WHERE user_id = s.user_id AND revoked_at IS NULL ORDER BY auth_session_id FOR UPDATE
 LOOP
  PERFORM warehouse_identity.revoke_auth_session(r.auth_session_id, s.user_id, 'SIGN_OUT_EVERYWHERE', p_request_id, p_correlation_id);
  n := n + 1;
 END LOOP;
 PERFORM warehouse_identity.iam_advance_session_epoch_v15(s.user_id, 'SIGN_OUT_EVERYWHERE', p_request_id, p_correlation_id, s.user_id);
 RETURN n;
END $fn$;

REVOKE ALL ON FUNCTION warehouse_identity.iam_epoch_event_trigger_v15(),
  warehouse_identity.iam_sign_out_everywhere_v15(bytea,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION warehouse_identity.iam_sign_out_everywhere_v15(bytea,uuid,uuid) TO tcds_login_api;
ALTER FUNCTION warehouse_identity.iam_epoch_event_trigger_v15() OWNER TO tcds_identity_function_owner;
ALTER FUNCTION warehouse_identity.iam_sign_out_everywhere_v15(bytea,uuid,uuid) OWNER TO tcds_identity_function_owner;

DO $down$ BEGIN
 IF NOT (SELECT had_create FROM r622_m) THEN EXECUTE 'REVOKE CREATE ON SCHEMA warehouse_identity FROM tcds_identity_function_owner'; END IF;
 IF (SELECT need FROM r622_m) THEN
  IF (SELECT had FROM r622_m) THEN
   EXECUTE format('GRANT tcds_identity_function_owner TO postgres WITH INHERIT %s, SET %s',
                  (SELECT m_inherit FROM r622_m)::text, (SELECT m_set FROM r622_m)::text);
  ELSE EXECUTE 'REVOKE tcds_identity_function_owner FROM postgres'; END IF;
 END IF;
END $down$;

DO $verify$
DECLARE f regprocedure;
BEGIN
 FOREACH f IN ARRAY ARRAY['warehouse_identity.iam_epoch_event_trigger_v15()'::regprocedure,
   'warehouse_identity.iam_sign_out_everywhere_v15(bytea,uuid,uuid)'::regprocedure,
   'warehouse_identity.iam_session_epoch_status_v15(uuid)'::regprocedure] LOOP
  IF (SELECT pg_get_userbyid(proowner) <> 'tcds_identity_function_owner' OR NOT prosecdef FROM pg_proc WHERE oid = f)
   THEN RAISE EXCEPTION 'R622_OWNER_OR_DEFINER_WRONG %', f; END IF;
  IF has_function_privilege('public', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
     OR has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('service_role', f, 'EXECUTE')
   THEN RAISE EXCEPTION 'R622_EXECUTE_TOO_BROAD %', f; END IF;
 END LOOP;
 IF NOT has_function_privilege('tcds_login_api', 'warehouse_identity.iam_sign_out_everywhere_v15(bytea,uuid,uuid)', 'EXECUTE')
  OR NOT has_function_privilege('tcds_login_api', 'warehouse_identity.iam_session_epoch_status_v15(uuid)', 'EXECUTE')
  THEN RAISE EXCEPTION 'R622_LOGIN_API_CANNOT_EXECUTE'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_iam_epoch_v15_%' AND NOT tgisinternal) <> 4
  THEN RAISE EXCEPTION 'R622_TRIGGERS_MISSING'; END IF;
END $verify$;
COMMIT;
