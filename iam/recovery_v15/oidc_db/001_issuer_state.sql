-- Apply ONLY to a dedicated central OIDC issuer database (NOT the Warehouse DB or retail EOC DB).
BEGIN;
CREATE SCHEMA IF NOT EXISTS eoc_oidc;
CREATE TABLE IF NOT EXISTS eoc_oidc.artifacts (
 model text NOT NULL, id text NOT NULL, payload jsonb NOT NULL, expires_at timestamptz NOT NULL,
 consumed_at timestamptz, PRIMARY KEY(model,id)
);
CREATE INDEX IF NOT EXISTS eoc_oidc_artifact_expiration_idx ON eoc_oidc.artifacts(expires_at);
CREATE INDEX IF NOT EXISTS eoc_oidc_artifact_uid_idx ON eoc_oidc.artifacts(model,(payload->>'uid'));
CREATE INDEX IF NOT EXISTS eoc_oidc_artifact_usercode_idx ON eoc_oidc.artifacts(model,(payload->>'userCode'));
CREATE INDEX IF NOT EXISTS eoc_oidc_artifact_grant_idx ON eoc_oidc.artifacts(model,(payload->>'grantId'));
CREATE TABLE IF NOT EXISTS eoc_oidc.passkey_interactions (
 interaction_id text PRIMARY KEY, challenge_id text NOT NULL, request_id uuid NOT NULL, options jsonb NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 consumed_at timestamptz, failed_attempts smallint NOT NULL DEFAULT 0,
 CHECK (failed_attempts BETWEEN 0 AND 5)
);
CREATE INDEX IF NOT EXISTS eoc_oidc_passkey_interaction_expires_idx ON eoc_oidc.passkey_interactions(expires_at);
CREATE TABLE IF NOT EXISTS eoc_oidc.issuer_security_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, request_id uuid NOT NULL,
 category text NOT NULL, interaction_hash text, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Deployment admin MUST provision a dedicated low privilege role and no CREATE/BYPASSRLS permissions.
ALTER TABLE eoc_oidc.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoc_oidc.passkey_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoc_oidc.issuer_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoc_oidc.artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE eoc_oidc.passkey_interactions FORCE ROW LEVEL SECURITY;
ALTER TABLE eoc_oidc.issuer_security_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA eoc_oidc FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA eoc_oidc FROM PUBLIC,anon,authenticated,service_role;
-- Admin must GRANT and create narrow RLS policies to oidc_issuer_runtime after reviewing deployment role identity.
-- Supplemental dedicated runtime role; it may never be granted to the retail EOC database account.
DO $role$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='eoc_oidc_runtime') THEN CREATE ROLE eoc_oidc_runtime NOLOGIN NOBYPASSRLS; END IF; END $role$;
GRANT USAGE ON SCHEMA eoc_oidc TO eoc_oidc_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON eoc_oidc.artifacts,eoc_oidc.passkey_interactions TO eoc_oidc_runtime;
GRANT INSERT ON eoc_oidc.issuer_security_events TO eoc_oidc_runtime;
GRANT USAGE ON SEQUENCE eoc_oidc.issuer_security_events_event_id_seq TO eoc_oidc_runtime;
CREATE POLICY oidc_artifacts_runtime ON eoc_oidc.artifacts TO eoc_oidc_runtime USING(true) WITH CHECK(true);
CREATE POLICY oidc_interactions_runtime ON eoc_oidc.passkey_interactions TO eoc_oidc_runtime USING(true) WITH CHECK(true);
CREATE POLICY oidc_events_runtime ON eoc_oidc.issuer_security_events FOR INSERT TO eoc_oidc_runtime WITH CHECK(true);
-- IMPORTANT: Operator must GRANT eoc_oidc_runtime TO <issuer_service_login> using controlled change.
-- Never assign postgres/superuser, BYPASSRLS, table owner, or IAM bridge credentials to the issuer.

COMMIT;
