-- Rollback for 603 + 603a (enterprise_org leadership directory).
-- Only while the directory is empty. Once leadership records exist, do not drop: follow the package's
-- "no destructive production rollback" procedure instead.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM enterprise_org.leadership_people)
     OR EXISTS (SELECT 1 FROM enterprise_org.positions)
     OR EXISTS (SELECT 1 FROM enterprise_org.leadership_appointments)
     OR EXISTS (SELECT 1 FROM enterprise_org.contact_points) THEN
    RAISE EXCEPTION 'ENTERPRISE_ORG_HAS_RECORDS_DO_NOT_DROP';
  END IF;
END $guard$;
DROP SCHEMA enterprise_org CASCADE;
COMMIT;
