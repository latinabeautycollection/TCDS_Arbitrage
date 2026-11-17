-- 930 ROLLBACK: removes the capture-snapshot function and its role. No data is touched.
DROP FUNCTION IF EXISTS warehouse_control.get_capture_authority_snapshot_v1(uuid, uuid);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_scanner_snapshot_api') THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_login_packship') THEN
      REVOKE tcds_scanner_snapshot_api FROM tcds_login_packship;
    END IF;
    REVOKE USAGE ON SCHEMA warehouse_control FROM tcds_scanner_snapshot_api;
    DROP ROLE tcds_scanner_snapshot_api;
  END IF;
END $$;
