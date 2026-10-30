BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION warehouse_identity.approve_password_reset_v3(p_approver_auth_session_id uuid, p_password_reset_request_id uuid, p_expected_row_version bigint, p_reset_token_hash bytea, p_expires_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'warehouse_identity'
AS $function$
DECLARE a record; r warehouse_identity.password_reset_requests;
BEGIN
 SELECT * INTO a FROM warehouse_identity.resolve_session_access(p_approver_auth_session_id,'warehouse:identity:password:reset_approve') LIMIT 1;
 IF NOT a.access_allowed OR a.assurance_level<>'AAL2' THEN RETURN 'APPROVER_NOT_AUTHORIZED'; END IF;
 SELECT * INTO r FROM warehouse_identity.password_reset_requests WHERE password_reset_request_id=p_password_reset_request_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 IF r.row_version<>p_expected_row_version OR r.status<>'REQUESTED' THEN RETURN 'STALE_OR_INVALID_STATE'; END IF;
 IF r.requested_by=a.user_id THEN RETURN 'SELF_APPROVAL_PROHIBITED'; END IF;
 IF p_expires_at<=clock_timestamp() OR p_expires_at>clock_timestamp()+interval '30 minutes' THEN RETURN 'INVALID_EXPIRY'; END IF;
 UPDATE warehouse_identity.password_reset_requests SET status='TOKEN_ISSUED',approved_by=a.user_id,approved_auth_session_id=p_approver_auth_session_id,token_hash=p_reset_token_hash,expires_at=p_expires_at,row_version=row_version+1 WHERE password_reset_request_id=r.password_reset_request_id;
 RETURN 'APPROVED';
END $function$
;
DROP FUNCTION IF EXISTS warehouse_identity.request_password_recovery_v62(uuid,text,text,uuid,uuid,uuid);
DROP FUNCTION IF EXISTS warehouse_identity.authorize_password_recovery_override_v62(uuid,uuid,uuid,text,text,uuid,uuid);
DROP FUNCTION IF EXISTS warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text);
DROP INDEX IF EXISTS warehouse_identity.recovery_request_source_id_v62_uq;
DROP INDEX IF EXISTS warehouse_identity.recovery_request_recent_v62_idx;
DROP TABLE IF EXISTS warehouse_identity.password_recovery_stepup_uses_v62;
DROP TABLE IF EXISTS warehouse_identity.password_recovery_stepup_authorizations_v62;
DROP TABLE IF EXISTS warehouse_identity.password_recovery_overrides_v62;
DELETE FROM warehouse_identity.roles r WHERE r.role_code='WAREHOUSE_RECOVERY_MANAGER'
  AND NOT EXISTS (SELECT 1 FROM warehouse_identity.user_role_assignments ra WHERE ra.role_id=r.role_id);
COMMIT;
