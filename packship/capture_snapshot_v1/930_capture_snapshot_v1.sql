-- =====================================================================================================================
-- 930  Warehouse Control capture-authority snapshot (scanner snapshot contract v1.0 §4, served in PR #13's shape).
-- One read-only function; no table changes. Selection is server-side from the session's device and facility:
--   1. DEVICE:   the PWA_CLIENT asset bound to this device (warehouse_device_id is unique, so at most one). If it exists
--                but is not usable (status not ONLINE/DEGRADED/OFFLINE, archived, in another facility, or no profile)
--                -> NOT_FOUND. No fallback, so switching one device's camera off really switches it off.
--   2. FACILITY: otherwise the usable PWA_CLIENT asset in the session's facility with no device. 0 -> NOT_FOUND,
--                more than 1 -> AMBIGUOUS. Never a guess.
-- Returns the scanner profile (camera fields only; configuration carries only "scanditWeb") and every
-- barcode_symbologies row. Hardware-scanner columns are never returned.
-- Access: role tcds_scanner_snapshot_api (NOLOGIN) only, granted to the Pack/Ship login tcds_login_packship.
-- =====================================================================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_scanner_snapshot_api') THEN
    CREATE ROLE tcds_scanner_snapshot_api NOLOGIN NOINHERIT;
  END IF;
END $$;
COMMENT ON ROLE tcds_scanner_snapshot_api IS 'EXECUTE on warehouse_control.get_capture_authority_snapshot_v1 only (930).';

CREATE OR REPLACE FUNCTION warehouse_control.get_capture_authority_snapshot_v1(p_warehouse_device_id uuid, p_facility_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_usable constant text[] := ARRAY['ONLINE', 'DEGRADED', 'OFFLINE'];
  v_asset uuid; v_binding text; v_n int; d record; v_profile jsonb; v_syms jsonb; a record;
BEGIN
  IF p_facility_id IS NULL THEN
    RETURN jsonb_build_object('result', 'NOT_FOUND', 'reason', 'NO_FACILITY');
  END IF;

  -- 1. device-bound
  IF p_warehouse_device_id IS NOT NULL THEN
    SELECT x.asset_id, x.status::text AS status, x.archived_at, x.facility_id,
           EXISTS (SELECT 1 FROM warehouse_control.scanner_profiles sp WHERE sp.asset_id = x.asset_id) AS has_profile
      INTO d
      FROM warehouse_control.assets x
      JOIN warehouse_control.asset_classes c ON c.asset_class_id = x.asset_class_id AND c.class_code::text = 'PWA_CLIENT'
     WHERE x.warehouse_device_id = p_warehouse_device_id;
    IF FOUND THEN
      IF d.archived_at IS NULL AND d.status = ANY (v_usable) AND d.facility_id = p_facility_id AND d.has_profile THEN
        v_asset := d.asset_id; v_binding := 'DEVICE';
      ELSE
        RETURN jsonb_build_object('result', 'NOT_FOUND', 'reason', 'DEVICE_ASSET_NOT_USABLE');
      END IF;
    END IF;
  END IF;

  -- 2. facility default
  IF v_asset IS NULL THEN
    SELECT count(*), min(x.asset_id::text)::uuid INTO v_n, v_asset
      FROM warehouse_control.assets x
      JOIN warehouse_control.asset_classes c ON c.asset_class_id = x.asset_class_id AND c.class_code::text = 'PWA_CLIENT'
      JOIN warehouse_control.scanner_profiles sp ON sp.asset_id = x.asset_id
     WHERE x.facility_id = p_facility_id AND x.warehouse_device_id IS NULL AND x.archived_at IS NULL
       AND x.status::text = ANY (v_usable);
    IF v_n = 0 THEN RETURN jsonb_build_object('result', 'NOT_FOUND', 'reason', 'NO_FACILITY_DEFAULT'); END IF;
    IF v_n > 1 THEN RETURN jsonb_build_object('result', 'AMBIGUOUS', 'reason', 'FACILITY_DEFAULTS', 'count', v_n); END IF;
    v_binding := 'FACILITY';
  END IF;

  SELECT x.asset_id, x.asset_code::text AS asset_code, x.facility_id, x.station_id INTO a
    FROM warehouse_control.assets x WHERE x.asset_id = v_asset;

  SELECT jsonb_build_object(
           'assetId', sp.asset_id::text,
           'scannerMode', sp.scanner_mode,
           'supportedSymbologies', to_jsonb(sp.supported_symbologies::text[]),
           'autoScanEnabled', sp.auto_scan_enabled,
           'continuousScanEnabled', sp.continuous_scan_enabled,
           'aimMode', sp.aim_mode,
           'illuminationEnabled', sp.illumination_enabled,
           'beepEnabled', sp.beep_enabled,
           'vibrationEnabled', sp.vibration_enabled,
           'duplicateSuppressionMs', sp.duplicate_suppression_ms,
           'configuration', CASE WHEN jsonb_typeof(sp.configuration -> 'scanditWeb') = 'object'
                                 THEN jsonb_build_object('scanditWeb', sp.configuration -> 'scanditWeb')
                                 ELSE '{}'::jsonb END,
           'updatedAt', to_char(sp.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    INTO v_profile
    FROM warehouse_control.scanner_profiles sp WHERE sp.asset_id = v_asset;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'symbologyCode', b.symbology_code::text, 'enabled', b.enabled, 'minLength', b.min_length,
           'maxLength', b.max_length, 'supportsCheckDigit', b.supports_check_digit, 'validationRegex', b.validation_regex)
           ORDER BY b.symbology_code::text), '[]'::jsonb)
    INTO v_syms FROM warehouse_control.barcode_symbologies b;

  RETURN jsonb_build_object('result', 'OK', 'binding', v_binding,
    'asset', jsonb_build_object('assetId', a.asset_id::text, 'assetCode', a.asset_code,
                                'facilityId', a.facility_id::text, 'stationId', a.station_id::text),
    'scannerProfile', v_profile, 'symbologies', v_syms);
END $$;

REVOKE ALL ON FUNCTION warehouse_control.get_capture_authority_snapshot_v1(uuid, uuid) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION warehouse_control.get_capture_authority_snapshot_v1(uuid, uuid) FROM %I', r);
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA warehouse_control TO tcds_scanner_snapshot_api;
GRANT EXECUTE ON FUNCTION warehouse_control.get_capture_authority_snapshot_v1(uuid, uuid) TO tcds_scanner_snapshot_api;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_login_packship') THEN
    GRANT tcds_scanner_snapshot_api TO tcds_login_packship WITH INHERIT TRUE, SET FALSE;
  END IF;
END $$;
COMMENT ON FUNCTION warehouse_control.get_capture_authority_snapshot_v1(uuid, uuid) IS
  'Capture-authority snapshot (contract v1.0 §4 selection, PR #13 shape). Read only. 930.';
