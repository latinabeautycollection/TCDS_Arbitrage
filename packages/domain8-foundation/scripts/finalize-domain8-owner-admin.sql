-- Optional platform-administrator ownership finalization.
-- Run only as a principal that owns the Domain 8 objects and can SET ROLE
-- tcds_domain8_owner (normally a superuser or a member of that role).

\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_owner') THEN
        RAISE EXCEPTION 'Role tcds_domain8_owner does not exist';
    END IF;

    IF NOT (
        current_setting('is_superuser')::boolean
        OR pg_has_role(current_user, 'tcds_domain8_owner', 'MEMBER')
    ) THEN
        RAISE EXCEPTION 'Current principal % cannot SET ROLE tcds_domain8_owner', current_user;
    END IF;
END
$$;

\ir ../database/migrations/809_domain8_ownership_and_privilege_finalization.sql
