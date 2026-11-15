-- STAGING ONLY: must not be used while live flows exist. Existing 001 tables retained.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM eoc_oidc.passkey_interactions WHERE consumed_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'ACTIVE_FLOW_ROLLBACK_DENIED'; END IF; END $$;
DROP INDEX IF EXISTS eoc_oidc.oidc_v11_interaction_state_idx;
ALTER TABLE eoc_oidc.passkey_interactions DROP CONSTRAINT IF EXISTS oidc_v11_interaction_state;
ALTER TABLE eoc_oidc.passkey_interactions DROP COLUMN IF EXISTS state;
COMMIT;
