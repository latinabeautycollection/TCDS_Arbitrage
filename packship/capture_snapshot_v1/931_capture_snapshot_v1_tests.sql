-- =====================================================================================================================
-- 931  Tests for 930. Run in the SAME transaction after 930, then ROLLBACK. Own fixtures (prefix CSN1).
-- =====================================================================================================================
CREATE TEMP TABLE _cr (n serial, test text, pass boolean, detail text) ON COMMIT DROP;
CREATE TEMP TABLE _cc (k text PRIMARY KEY, v text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.ct(p_test text, p_pass boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO _cr (test, pass, detail) VALUES (p_test, coalesce(p_pass, false), p_detail) $$;
CREATE FUNCTION pg_temp.cu(p_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v::uuid FROM _cc WHERE k = p_k $$;

DO $$
DECLARE f uuid; f2 uuid; cls uuid; d1 uuid; d2 uuid; d3 uuid; a_fac uuid; a_dev uuid; a_dev3 uuid;
BEGIN
  SELECT asset_class_id INTO cls FROM warehouse_control.asset_classes WHERE class_code::text = 'PWA_CLIENT';
  IF cls IS NULL THEN   -- replica only; production has the class
    INSERT INTO warehouse_control.asset_classes (asset_class_id, class_code, class_name, category, expected_heartbeat_sec,
      offline_after_sec, telemetry_retention_days, supports_commands, default_configuration, created_at, updated_at)
    VALUES (gen_random_uuid(), 'PWA_CLIENT', 'PWA client', 'CLIENT', 60, 300, 30, false, '{}', now(), now())
    RETURNING asset_class_id INTO cls;
  END IF;
  INSERT INTO warehouse.facilities (facility_code, facility_name, address_line1, city, state_province_code, postal_code)
  VALUES ('CSN1-TEST', 'CSN1 test facility', '1 Test St', 'Testville', 'VA', '22554') RETURNING facility_id INTO f;
  INSERT INTO warehouse.facilities (facility_code, facility_name, address_line1, city, state_province_code, postal_code)
  VALUES ('CSN1-OTHER', 'CSN1 other facility', '2 Test St', 'Testville', 'VA', '22554') RETURNING facility_id INTO f2;
  INSERT INTO warehouse.devices (facility_id, device_type, status, device_name, serial_number, hardware_fingerprint)
  VALUES (f, 'PWA_IOS', 'ACTIVE', 'CSN1 phone 1', 'CSN1-SN-1', 'csn1-hw-1') RETURNING device_id INTO d1;
  INSERT INTO warehouse.devices (facility_id, device_type, status, device_name, serial_number, hardware_fingerprint)
  VALUES (f, 'PWA_IOS', 'ACTIVE', 'CSN1 phone 2', 'CSN1-SN-2', 'csn1-hw-2') RETURNING device_id INTO d2;
  INSERT INTO warehouse.devices (facility_id, device_type, status, device_name, serial_number, hardware_fingerprint)
  VALUES (f, 'PWA_IOS', 'ACTIVE', 'CSN1 phone 3', 'CSN1-SN-3', 'csn1-hw-3') RETURNING device_id INTO d3;
  INSERT INTO warehouse_control.assets (facility_id, warehouse_device_id, asset_class_id, asset_code, asset_name, status,
    connection_type, manufacturer, serial_number, asset_tag, hardware_uuid)
  VALUES (f, NULL, cls, 'CSN1-FAC', 'CSN1 facility default', 'ONLINE', 'CLOUD', 'TCDS', 'CSN1-FAC', 'CSN1-FAC', 'csn1:fac')
  RETURNING asset_id INTO a_fac;
  INSERT INTO warehouse_control.assets (facility_id, warehouse_device_id, asset_class_id, asset_code, asset_name, status,
    connection_type, manufacturer, serial_number, asset_tag, hardware_uuid)
  VALUES (f, d1, cls, 'CSN1-DEV1', 'CSN1 device 1', 'ONLINE', 'CLOUD', 'TCDS', 'CSN1-DEV1', 'CSN1-DEV1', 'csn1:dev1')
  RETURNING asset_id INTO a_dev;
  INSERT INTO warehouse_control.assets (facility_id, warehouse_device_id, asset_class_id, asset_code, asset_name, status,
    connection_type, manufacturer, serial_number, asset_tag, hardware_uuid)
  VALUES (f, d3, cls, 'CSN1-DEV3', 'CSN1 device 3', 'MAINTENANCE', 'CLOUD', 'TCDS', 'CSN1-DEV3', 'CSN1-DEV3', 'csn1:dev3')
  RETURNING asset_id INTO a_dev3;
  INSERT INTO warehouse_control.scanner_profiles (asset_id, scanner_mode, supported_symbologies, auto_scan_enabled,
    continuous_scan_enabled, beep_enabled, vibration_enabled, duplicate_suppression_ms, configuration, updated_at, prefix, suffix)
  SELECT x, 'SCANDIT_WEB', '{CODE128,EAN13,UPC_A,QR}', true, false, true, true, 1000,
         '{"scanditWeb":{"captureTimeoutMs":30000},"hardwareOnly":{"x":1}}'::jsonb, '2026-11-17T06:00:00Z', 'PFX', 'SFX'
    FROM unnest(ARRAY[a_fac, a_dev, a_dev3]) x;
  INSERT INTO _cc VALUES ('f', f), ('f2', f2), ('d1', d1), ('d2', d2), ('d3', d3), ('a_fac', a_fac), ('a_dev', a_dev), ('cls', cls);
END $$;

DO $$
DECLARE r jsonb; f uuid := pg_temp.cu('f'); d1 uuid := pg_temp.cu('d1'); d2 uuid := pg_temp.cu('d2'); d3 uuid := pg_temp.cu('d3');
  a_fac uuid := pg_temp.cu('a_fac'); a_dev uuid := pg_temp.cu('a_dev'); p jsonb;
BEGIN
  r := warehouse_control.get_capture_authority_snapshot_v1(d2, f);
  PERFORM pg_temp.ct('C01 device without its own asset: facility default, binding FACILITY',
    r->>'result' = 'OK' AND r->>'binding' = 'FACILITY' AND r->'asset'->>'assetId' = a_fac::text, r::text);
  r := warehouse_control.get_capture_authority_snapshot_v1(d1, f);
  PERFORM pg_temp.ct('C02 device-bound asset wins over the facility default',
    r->>'result' = 'OK' AND r->>'binding' = 'DEVICE' AND r->'scannerProfile'->>'assetId' = a_dev::text, r->>'binding');
  r := warehouse_control.get_capture_authority_snapshot_v1(d3, f);
  PERFORM pg_temp.ct('C03 device asset in MAINTENANCE: NOT_FOUND, no fallback to the usable facility default',
    r->>'result' = 'NOT_FOUND' AND r->>'reason' = 'DEVICE_ASSET_NOT_USABLE', r::text);
  r := warehouse_control.get_capture_authority_snapshot_v1(d1, pg_temp.cu('f2'));
  PERFORM pg_temp.ct('C04 device asset in another facility than the session: NOT_FOUND',
    r->>'result' = 'NOT_FOUND', r::text);

  p := warehouse_control.get_capture_authority_snapshot_v1(d2, f)->'scannerProfile';
  PERFORM pg_temp.ct('C05 PR #13 profile fields all present with the right types',
    jsonb_typeof(p->'assetId') = 'string' AND p->>'scannerMode' = 'SCANDIT_WEB'
    AND p->'supportedSymbologies' = '["CODE128","EAN13","UPC_A","QR"]'::jsonb
    AND jsonb_typeof(p->'autoScanEnabled') = 'boolean' AND p->>'continuousScanEnabled' = 'false'
    AND jsonb_typeof(p->'beepEnabled') = 'boolean' AND jsonb_typeof(p->'vibrationEnabled') = 'boolean'
    AND (p->>'duplicateSuppressionMs')::int = 1000 AND p ? 'aimMode' AND p ? 'illuminationEnabled', p::text);
  PERFORM pg_temp.ct('C06 updatedAt is ISO-8601 UTC with Z',
    p->>'updatedAt' = '2026-11-17T06:00:00.000Z', p->>'updatedAt');
  PERFORM pg_temp.ct('C07 configuration carries only scanditWeb; hardware columns never sent',
    p->'configuration' = '{"scanditWeb":{"captureTimeoutMs":30000}}'::jsonb
    AND NOT (p ?| ARRAY['prefix','suffix','interCharacterDelayMs','expectedScanRatePerMin','minimumBatteryPercent']), p->>'configuration');
  r := warehouse_control.get_capture_authority_snapshot_v1(d2, f);
  PERFORM pg_temp.ct('C08 symbologies: every barcode_symbologies row in PR #13 field names',
    jsonb_array_length(r->'symbologies') = (SELECT count(*) FROM warehouse_control.barcode_symbologies)
    AND (SELECT bool_and(s ?& ARRAY['symbologyCode','enabled','minLength','maxLength','supportsCheckDigit','validationRegex'])
           FROM jsonb_array_elements(r->'symbologies') s), (r->'symbologies'->0)::text);

  UPDATE warehouse_control.assets SET status = 'PROVISIONING' WHERE asset_id = a_fac;
  r := warehouse_control.get_capture_authority_snapshot_v1(d2, f);
  PERFORM pg_temp.ct('C09 facility default PROVISIONING: NOT_FOUND', r->>'result' = 'NOT_FOUND', r::text);
  UPDATE warehouse_control.assets SET status = 'OFFLINE' WHERE asset_id = a_fac;
  r := warehouse_control.get_capture_authority_snapshot_v1(d2, f);
  PERFORM pg_temp.ct('C10 facility default OFFLINE is usable (PWA asset has no heartbeat)', r->>'result' = 'OK', r->>'result');
  UPDATE warehouse_control.assets SET archived_at = now() WHERE asset_id = a_fac;
  r := warehouse_control.get_capture_authority_snapshot_v1(d2, f);
  PERFORM pg_temp.ct('C11 archived facility default: NOT_FOUND', r->>'result' = 'NOT_FOUND', r::text);
  UPDATE warehouse_control.assets SET archived_at = NULL, status = 'ONLINE' WHERE asset_id = a_fac;

  INSERT INTO warehouse_control.assets (facility_id, asset_class_id, asset_code, asset_name, status, connection_type,
    manufacturer, serial_number, asset_tag, hardware_uuid)
  VALUES (f, pg_temp.cu('cls'), 'CSN1-FAC2', 'CSN1 second default', 'ONLINE', 'CLOUD', 'TCDS', 'CSN1-FAC2', 'CSN1-FAC2', 'csn1:fac2');
  INSERT INTO warehouse_control.scanner_profiles (asset_id, scanner_mode, supported_symbologies, auto_scan_enabled,
    continuous_scan_enabled, beep_enabled, vibration_enabled, duplicate_suppression_ms, configuration, updated_at)
  SELECT asset_id, 'SCANDIT_WEB', '{CODE128}', true, false, true, true, 1000, '{}', now()
    FROM warehouse_control.assets WHERE asset_code::text = 'CSN1-FAC2';
  r := warehouse_control.get_capture_authority_snapshot_v1(d2, f);
  PERFORM pg_temp.ct('C12 two usable facility defaults: AMBIGUOUS (never picks one)', r->>'result' = 'AMBIGUOUS', r::text);
  r := warehouse_control.get_capture_authority_snapshot_v1(d1, f);
  PERFORM pg_temp.ct('C13 device-bound still resolves when the facility level is ambiguous', r->>'binding' = 'DEVICE', r->>'result');
  r := warehouse_control.get_capture_authority_snapshot_v1(NULL, NULL);
  PERFORM pg_temp.ct('C14 no facility: NOT_FOUND', r->>'result' = 'NOT_FOUND', r::text);
  r := warehouse_control.get_capture_authority_snapshot_v1(NULL, pg_temp.cu('f2'));
  PERFORM pg_temp.ct('C15 facility with no PWA asset: NOT_FOUND', r->>'result' = 'NOT_FOUND', r::text);
END $$;

DO $$
DECLARE v_bad text; fn regprocedure := 'warehouse_control.get_capture_authority_snapshot_v1(uuid,uuid)'::regprocedure;
BEGIN
  SELECT string_agg(r.rolname, ',') INTO v_bad FROM pg_roles r
   WHERE r.rolname IN ('anon', 'authenticated', 'service_role') AND has_function_privilege(r.rolname, fn, 'EXECUTE');
  PERFORM pg_temp.ct('C16 anon/authenticated/service_role cannot execute', v_bad IS NULL, v_bad);
  PERFORM pg_temp.ct('C17 PUBLIC cannot execute',
    NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = fn AND x.grantee = 0));
  PERFORM pg_temp.ct('C18 tcds_scanner_snapshot_api: execute yes, no table access',
    has_function_privilege('tcds_scanner_snapshot_api', fn, 'EXECUTE')
    AND NOT has_table_privilege('tcds_scanner_snapshot_api', 'warehouse_control.scanner_profiles', 'SELECT')
    AND NOT has_table_privilege('tcds_scanner_snapshot_api', 'warehouse_control.assets', 'SELECT'));
  PERFORM pg_temp.ct('C19 tcds_login_packship inherits it (when that login exists)',
    NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_login_packship')
    OR has_function_privilege('tcds_login_packship', fn, 'EXECUTE'));
  PERFORM pg_temp.ct('C20 tcds_login_packship still has no table access to scanner data',
    NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_login_packship')
    OR NOT has_table_privilege('tcds_login_packship', 'warehouse_control.scanner_profiles', 'SELECT'));
END $$;

SELECT format('%s %s%s', CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END, test, CASE WHEN pass OR detail IS NULL THEN '' ELSE '  [' || detail || ']' END)
  FROM _cr ORDER BY n;
SELECT format('SUMMARY capture snapshot: %s passed, %s failed, %s total', count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass), count(*)) FROM _cr;
