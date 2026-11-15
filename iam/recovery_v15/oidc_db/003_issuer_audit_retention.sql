-- Issuer-owned audit retention mechanism, dedicated issuer database ONLY.
-- Default figures are a proposed internal policy, not regulatory certification.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS eoc_oidc.audit_legal_holds (
 hold_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_reference text NOT NULL UNIQUE,
 hold_from timestamptz NOT NULL,
 hold_until timestamptz,
 authorized_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (hold_until IS NULL OR hold_until>hold_from)
);
CREATE TABLE IF NOT EXISTS eoc_oidc.audit_archival_receipts (
 archive_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id_from bigint NOT NULL,
 event_id_through bigint NOT NULL,
 archive_location text NOT NULL,
 archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
 archive_verified_at timestamptz NOT NULL,
 independent_verifier text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (event_id_through>=event_id_from)
);
CREATE INDEX IF NOT EXISTS issuer_security_events_retention_idx ON eoc_oidc.issuer_security_events(occurred_at,event_id);
ALTER TABLE eoc_oidc.audit_legal_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoc_oidc.audit_legal_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE eoc_oidc.audit_archival_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoc_oidc.audit_archival_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON eoc_oidc.audit_legal_holds,eoc_oidc.audit_archival_receipts FROM PUBLIC;
-- No runtime grants; only independently controlled archival service may manage these records.
COMMIT;
