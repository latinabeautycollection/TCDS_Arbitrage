-- Domain 8 foundation remediation #1 — pgcrypto search_path (managed PG / Supabase)
-- On Supabase, pgcrypto is installed in the `extensions` schema, so digest() only
-- exists there. sha256_jsonb()/sha256_text() (migration 801) are IMMUTABLE SQL
-- funcs with no pinned search_path -> they get INLINED and resolve digest() under
-- the caller's pinned `search_path=pg_catalog, return_defense` (no extensions) ->
-- ERROR: function digest(bytea, unknown) does not exist. Pinning search_path also
-- disables inlining, so digest() resolves. Idempotent; reversible via RESET.
ALTER FUNCTION return_defense.sha256_jsonb(jsonb) SET search_path = pg_catalog, return_defense, extensions;
ALTER FUNCTION return_defense.sha256_text(text)  SET search_path = pg_catalog, return_defense, extensions;
