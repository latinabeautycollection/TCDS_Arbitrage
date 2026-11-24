-- 630 rollback: remove the central EOC grant approval. Requests and approvals are audit data: if any exist, the rollback
-- refuses unless the session sets   SET tcds.r630_delete_grant_approvals = 'yes';   (rehearsals only).
-- EOC grants already created in the retail EOC DB are NOT touched here (revoke them there).
-- The approver role is removed only when nobody holds it.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
DECLARE n_req int; n_ctx int; n_assign int;
BEGIN
 SELECT count(*) INTO n_req FROM warehouse_identity.central_grant_requests;
 SELECT count(*) INTO n_ctx FROM warehouse_identity.central_challenge_context WHERE purpose = 'EOC_GRANT_APPROVAL';
 IF (n_req > 0 OR n_ctx > 0) AND coalesce(current_setting('tcds.r630_delete_grant_approvals', true), '') <> 'yes' THEN
   RAISE EXCEPTION 'R630_ROLLBACK_REFUSED: % grant requests and % approval challenges exist (audit data)', n_req, n_ctx;
 END IF;
 SELECT count(*) INTO n_assign FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.roles rol USING (role_id)
  WHERE rol.role_code = 'EOC_MODULE_GRANT_APPROVER';
 IF n_assign > 0 AND coalesce(current_setting('tcds.r630_delete_grant_approvals', true), '') <> 'yes' THEN
   RAISE EXCEPTION 'R630_ROLLBACK_REFUSED: the grant approver role is assigned to % people (revoke first)', n_assign;
 END IF;
 DELETE FROM warehouse_identity.user_role_assignments ra USING warehouse_identity.roles rol
  WHERE rol.role_id = ra.role_id AND rol.role_code = 'EOC_MODULE_GRANT_APPROVER';
 DELETE FROM warehouse_identity.central_grant_approvals;
 DELETE FROM warehouse_identity.central_challenge_context WHERE purpose = 'EOC_GRANT_APPROVAL';
 DELETE FROM warehouse_identity.central_grant_requests;
END $guard$;

DROP FUNCTION IF EXISTS
  warehouse_identity.central_record_grants_v1(uuid,uuid[],uuid[]),
  warehouse_identity.central_finalize_grant_approval_v1(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid),
  warehouse_identity.central_grant_approval_begin_v1(uuid,text,text,bytea,uuid,uuid),
  warehouse_identity.central_grant_request_info_v1(uuid),
  warehouse_identity.central_cancel_grant_request_v1(uuid),
  warehouse_identity.central_request_grants_v1(uuid,jsonb,integer,text,uuid,integer),
  warehouse_identity.central_normalize_grant_items_v1(jsonb),
  warehouse_identity.central_is_grant_approver_v1(uuid);
ALTER TABLE warehouse_identity.central_challenge_context DROP CONSTRAINT IF EXISTS central_challenge_context_grant_check;
ALTER TABLE warehouse_identity.central_challenge_context DROP COLUMN IF EXISTS grant_request_id;
ALTER TABLE warehouse_identity.central_challenge_context DROP CONSTRAINT central_challenge_context_purpose_check;
ALTER TABLE warehouse_identity.central_challenge_context ADD CONSTRAINT central_challenge_context_purpose_check
  CHECK (purpose IN ('CENTRAL_PASSKEY_ENROLLMENT', 'EOC_OIDC_LOGIN', 'EOC_BINDING_APPROVAL'));
DROP TABLE IF EXISTS warehouse_identity.central_grant_approvals;
DROP TABLE IF EXISTS warehouse_identity.central_grant_requests;
DELETE FROM warehouse_identity.roles WHERE role_code = 'EOC_MODULE_GRANT_APPROVER';
COMMIT;
