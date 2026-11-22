-- 644_pre (ours). Run FIRST, before vendor 634/635/637/640/641 and our 644.
-- Records what our full rollback (644_rollback) must restore: the exact 621 guard definition and the privileges
-- tcds_identity_function_owner holds today on every object the recovery runtime touches.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s';
DO $pre$ BEGIN
 IF to_regclass('warehouse_identity.recovery_v192_ledger') IS NOT NULL THEN RAISE EXCEPTION 'R644_ALREADY_STARTED'; END IF;
 IF to_regprocedure('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)') IS NULL
 OR to_regprocedure('warehouse_identity.recovery_consume_supplemental_proof_v15(uuid,uuid,uuid)') IS NULL
 OR to_regprocedure('warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text)') IS NULL
 OR to_regprocedure('warehouse_identity.request_password_recovery_v62(uuid,text,text,uuid,uuid,uuid)') IS NULL
 OR to_regclass('warehouse_identity.recovery_contact_challenges_v1') IS NULL
 THEN RAISE EXCEPTION 'R644_PREREQUISITES_MISSING (needs 602, 604-622)'; END IF;
 IF position('NO_SUPPLEMENTAL' IN pg_get_functiondef('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'::regprocedure)) = 0
 THEN RAISE EXCEPTION 'R644_GUARD_IS_NOT_THE_621_ORIGINAL'; END IF;
 IF to_regclass('warehouse_identity.recovery_secret_outbox_v18') IS NOT NULL
 OR to_regprocedure('warehouse_identity.recovery_proof_eligible_v18(uuid,uuid)') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('tcds_recovery_verifier_v18','tcds_recovery_otp_v18','tcds_recovery_delivery_v18'))
 THEN RAISE EXCEPTION 'R644_VENDOR_V18_OBJECTS_ALREADY_PRESENT'; END IF;
 IF NOT pg_has_role('postgres','tcds_identity_function_owner','SET')
 THEN RAISE EXCEPTION 'R644_POSTGRES_NEEDS_SET_ON_FUNCTION_OWNER (apply the 621 membership step first)'; END IF;
END $pre$;

CREATE TABLE warehouse_identity.recovery_v192_ledger (item text PRIMARY KEY, value text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE warehouse_identity.recovery_v192_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_v192_ledger FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.recovery_v192_ledger FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO warehouse_identity.recovery_v192_ledger(item, value)
SELECT 'guard_def', pg_get_functiondef('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'::regprocedure)
UNION ALL SELECT 'guard_md5', md5(pg_get_functiondef('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'::regprocedure))
UNION ALL
-- DIRECT grants only (aclexplode), so the rollback removes exactly what was added and the ACL text comes back identical.
SELECT 'priv:'||t, coalesce((SELECT string_agg(DISTINCT x.privilege_type, ',') FROM pg_class c, aclexplode(c.relacl) x
  WHERE c.oid = ('warehouse_identity.'||t)::regclass AND x.grantee = 'tcds_identity_function_owner'::regrole), '')
FROM unnest(ARRAY['password_reset_requests','user_recovery_contacts','recovery_contact_challenges_v1','recovery_proofs_v1',
 'users','employees','user_role_assignments','roles','auth_sessions','passkeys','auth_challenges','webauthn_verification_evidence']) t
UNION ALL
SELECT 'exec:'||f, EXISTS (SELECT 1 FROM pg_proc pr, aclexplode(pr.proacl) x WHERE pr.oid = f::regprocedure
  AND x.grantee = 'tcds_identity_function_owner'::regrole AND x.privilege_type = 'EXECUTE')::text
FROM unnest(ARRAY['warehouse_identity.request_password_recovery_v62(uuid,text,text,uuid,uuid,uuid)',
 'warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text)']) f;
COMMIT;
