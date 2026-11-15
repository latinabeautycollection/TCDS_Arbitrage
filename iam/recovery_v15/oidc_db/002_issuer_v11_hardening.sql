-- Additive migration ONLY on dedicated issuer database; preserve 623 on central IAM.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN IF to_regclass('eoc_oidc.passkey_interactions') IS NULL OR to_regclass('eoc_oidc.artifacts') IS NULL THEN RAISE EXCEPTION 'OIDC_V10_SCHEMA_REQUIRED'; END IF; END $$;
ALTER TABLE eoc_oidc.passkey_interactions ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'CHALLENGE_ISSUED';
ALTER TABLE eoc_oidc.passkey_interactions DROP CONSTRAINT IF EXISTS oidc_v11_interaction_state;
ALTER TABLE eoc_oidc.passkey_interactions ADD CONSTRAINT oidc_v11_interaction_state CHECK (state IN ('ISSUING','CHALLENGE_ISSUED','VERIFYING','VERIFIED','COMPLETED','FAILED'));
CREATE INDEX IF NOT EXISTS oidc_v11_interaction_state_idx ON eoc_oidc.passkey_interactions(state,expires_at);
-- Old flows cannot be relied upon after rollout; revoke pending challenges on activation.
UPDATE eoc_oidc.passkey_interactions SET state='FAILED',consumed_at=clock_timestamp() WHERE consumed_at IS NULL;
COMMIT;
