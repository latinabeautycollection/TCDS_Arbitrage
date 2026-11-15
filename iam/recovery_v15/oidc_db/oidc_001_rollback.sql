-- Our rollback for vendor 001 (the package ships none), plus our database-level grant. STAGING ONLY.
-- The database itself stays, with PUBLIC still locked out (its state from create-db).
-- Run after the vendor 003 and 002 rollbacks. Refuses while any issuer row exists or a login still holds the runtime role.
DO $guard$
DECLARE n bigint;
BEGIN
  IF to_regnamespace('eoc_oidc') IS NULL THEN RETURN; END IF;
  SELECT (SELECT count(*) FROM eoc_oidc.artifacts) + (SELECT count(*) FROM eoc_oidc.passkey_interactions)
       + (SELECT count(*) FROM eoc_oidc.issuer_security_events) INTO n;
  IF n > 0 THEN RAISE EXCEPTION 'OIDC_001_ROLLBACK_REFUSED_DATA_PRESENT (% rows)', n; END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'eoc_oidc_runtime'::regrole
             AND pg_get_userbyid(m.member) <> current_user) THEN
    RAISE EXCEPTION 'OIDC_001_ROLLBACK_REFUSED_ROLE_STILL_GRANTED (unbind the issuer login first)';
  END IF;
END $guard$;
DROP TABLE IF EXISTS eoc_oidc.artifacts, eoc_oidc.passkey_interactions, eoc_oidc.issuer_security_events;
DROP SCHEMA IF EXISTS eoc_oidc;
DO $roles$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eoc_oidc_runtime') THEN
    EXECUTE 'REVOKE CONNECT ON DATABASE eoc_oidc FROM eoc_oidc_runtime';
    EXECUTE 'DROP ROLE eoc_oidc_runtime';
  END IF;
END $roles$;
