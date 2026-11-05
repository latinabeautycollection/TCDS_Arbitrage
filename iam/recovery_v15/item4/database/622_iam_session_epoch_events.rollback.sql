-- Rollback of 622. Run BEFORE 621's and 620's rollbacks. Restores 620's iam_session_epoch_status_v15 text exactly.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
DO $pre$ BEGIN
 IF to_regprocedure('warehouse_identity.iam_sign_out_everywhere_v15(bytea,uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'R622_NOT_INSTALLED'; END IF;
END $pre$;
CREATE TEMP TABLE r622_rb ON COMMIT DROP AS
SELECT NOT pg_has_role('postgres','tcds_identity_function_owner','USAGE') AS need,
       (SELECT inherit_option FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole) AS m_inherit,
       (SELECT set_option FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole) AS m_set,
       EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole) AS had;
DO $up$ BEGIN
 IF (SELECT need FROM r622_rb) THEN EXECUTE 'GRANT tcds_identity_function_owner TO postgres WITH INHERIT TRUE'; END IF;
END $up$;

DROP TRIGGER trg_iam_epoch_v15_users ON warehouse_identity.users;
DROP TRIGGER trg_iam_epoch_v15_employees ON warehouse_identity.employees;
DROP TRIGGER trg_iam_epoch_v15_passkeys ON warehouse_identity.passkeys;
DROP TRIGGER trg_iam_epoch_v15_revocation_commands ON warehouse_identity.session_revocation_commands;
DROP FUNCTION warehouse_identity.iam_epoch_event_trigger_v15();
DROP FUNCTION warehouse_identity.iam_sign_out_everywhere_v15(bytea,uuid,uuid);

CREATE OR REPLACE FUNCTION warehouse_identity.iam_session_epoch_status_v15(p_user_id uuid)
RETURNS TABLE (user_active boolean, epoch bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
 SELECT coalesce((SELECT u.status = 'ACTIVE' AND u.archived_at IS NULL
                          AND (u.locked_until IS NULL OR u.locked_until < clock_timestamp())
                   FROM warehouse_identity.users u WHERE u.user_id = p_user_id), false),
        coalesce((SELECT e.epoch FROM warehouse_identity.iam_session_epochs_v15 e WHERE e.user_id = p_user_id), 0);
$fn$;

DO $down$ BEGIN
 IF (SELECT need FROM r622_rb) THEN
  IF (SELECT had FROM r622_rb) THEN
   EXECUTE format('GRANT tcds_identity_function_owner TO postgres WITH INHERIT %s, SET %s',
                  (SELECT m_inherit FROM r622_rb)::text, (SELECT m_set FROM r622_rb)::text);
  ELSE EXECUTE 'REVOKE tcds_identity_function_owner FROM postgres'; END IF;
 END IF;
END $down$;
COMMIT;
