-- Review-only additive hardening; for isolated staging after 604,604a,608.
-- No existing Warehouse Login/Domain10/EOC tables modified.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
 IF to_regclass('warehouse_identity.user_recovery_contacts') IS NULL
    OR to_regclass('warehouse_identity.recovery_contact_challenges_v1') IS NULL
    OR to_regclass('warehouse_identity.recovery_proofs_v1') IS NULL
    OR to_regclass('warehouse_identity.recovery_destination_reviews_v11') IS NULL
    OR to_regclass('enterprise_org.leadership_people') IS NULL
    OR to_regclass('warehouse_identity.password_recovery_stepup_authorizations_v62') IS NULL
 THEN RAISE EXCEPTION 'V12_DEPENDENCY_NOT_INSTALLED'; END IF;
END $preflight$;
-- A delivery receipt may match one challenge only; no unverifiable reference substitution.
CREATE UNIQUE INDEX ux_recovery_v12_delivery_reference
ON warehouse_identity.recovery_contact_challenges_v1(delivery_reference)
WHERE delivery_reference IS NOT NULL;
-- Verification date must not predate enrollment. Revocation invalidates future use.
ALTER TABLE warehouse_identity.user_recovery_contacts
 ADD CONSTRAINT ck_recovery_v12_verified_after_created
 CHECK(verified_at IS NULL OR verified_at>=created_at);
-- Prevent endless unverified contacts from becoming a silent secondary login route.
CREATE INDEX ix_recovery_v12_challenge_user_time
ON warehouse_identity.recovery_contact_challenges_v1(user_id,created_at DESC);
-- This is intentionally additive. All sensitive tables retain FORCE RLS with zero permissive policies.
DO $verify$
BEGIN
 IF EXISTS(
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='warehouse_identity' AND c.relname IN (
   'user_recovery_contacts','recovery_contact_challenges_v1','recovery_proofs_v1','supervised_recovery_proof_consumptions_v1','recovery_destination_reviews_v11')
   AND c.relkind='r' AND NOT(c.relrowsecurity AND c.relforcerowsecurity)
 ) THEN RAISE EXCEPTION 'RECOVERY_V12_RLS_NOT_FORCED'; END IF;
END $verify$;
COMMIT;
