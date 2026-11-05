-- TCDS Domain 6 / IAM V1.5. Additive security lifecycle; DEPLOY BEFORE BFF epoch enforcement.
-- Existing credential/password history/warehouse sessions remain owned by consume_password_reset_v5.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$ BEGIN
 IF to_regclass('warehouse_identity.users') IS NULL OR
    to_regprocedure('warehouse_identity.consume_password_reset_v5(uuid,bytea,bytea,text,jsonb,uuid,uuid,uuid)') IS NULL
 THEN RAISE EXCEPTION 'IAM_V15_EXISTING_RESET_AUTHORITY_MISSING'; END IF;
 IF to_regclass('warehouse_identity.iam_session_epochs_v15') IS NOT NULL
 THEN RAISE EXCEPTION 'IAM_V15_EPOCHS_ALREADY_EXIST'; END IF;
END $preflight$;
CREATE TABLE warehouse_identity.iam_session_epochs_v15 (
 user_id uuid PRIMARY KEY REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
 epoch bigint NOT NULL DEFAULT 0 CHECK(epoch>=0),
 reason text NOT NULL CHECK(reason IN ('INITIAL','PASSWORD_RESET','IDENTITY_SUSPENDED','GLOBAL_REVOCATION')),
 last_request_id uuid,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE warehouse_identity.iam_session_epochs_v15 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.iam_session_epochs_v15 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.iam_session_epochs_v15 FROM PUBLIC,anon,authenticated,service_role;
-- No public execution, SELECT, or direct write permissions. The established
-- privileged IAM server's transaction performs the narrowly scoped mutation.
-- Application-specific runtime role wiring must be separately certified.
COMMIT;
