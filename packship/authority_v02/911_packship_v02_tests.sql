-- =====================================================================================================================
-- 911  Pack/Ship V0.2 tests. Run in the SAME transaction as 910, then ROLLBACK. Creates its own test facility,
-- users, devices, sessions, items and order (all prefixed PSV02). Prints one line per test and a summary.
-- =====================================================================================================================
CREATE TEMP TABLE _r (n serial, test text, pass boolean, detail text) ON COMMIT DROP;
CREATE TEMP TABLE _c (k text PRIMARY KEY, v text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.t(p_test text, p_pass boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO _r (test, pass, detail) VALUES (p_test, coalesce(p_pass, false), p_detail) $$;
-- Runs SQL, returns the error MESSAGE (our code) or 'NO_ERROR'
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'NO_ERROR'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE FUNCTION pg_temp.c(p_k text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM _c WHERE k = p_k $$;
CREATE FUNCTION pg_temp.u(p_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v::uuid FROM _c WHERE k = p_k $$;
CREATE FUNCTION pg_temp.k() RETURNS text LANGUAGE sql AS $$ SELECT 'psv02-' || gen_random_uuid()::text $$;
CREATE FUNCTION pg_temp.rv(p_task uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT row_version FROM warehouse.packing_tasks WHERE packing_task_id = p_task $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE f uuid; st uuid; l_src uuid; l_stg uuid; l_bad uuid; role uuid; u record; d uuid; ds uuid; sess uuid;
  i1 uuid; i2 uuid; i3 uuid; o1 uuid; o2 uuid; prof uuid; now_ts timestamptz := clock_timestamp(); k text;
BEGIN
  INSERT INTO warehouse.facilities (facility_code, facility_name, address_line1, city, state_province_code, postal_code)
  VALUES ('PSV02-TEST', 'PSV02 test facility', '1 Test St', 'Testville', 'VA', '22554') RETURNING facility_id INTO f;
  INSERT INTO warehouse.stations (facility_id, station_code, station_name, station_type)
  VALUES (f, 'PSV02-PACK-01', 'PSV02 pack station', 'PACKING_STATION') RETURNING station_id INTO st;
  INSERT INTO warehouse.locations (facility_id, location_code, location_name, location_type, barcode_value, path_code)
  VALUES (f, 'PSV02-SRC-01', 'PSV02 source bin', 'BIN', 'PSV02-SRC-01', 'PSV02/SRC/01') RETURNING location_id INTO l_src;
  INSERT INTO warehouse.locations (facility_id, location_code, location_name, location_type, barcode_value, path_code)
  VALUES (f, 'PSV02-STG-01', 'PSV02 outbound staging', 'STAGING', 'PSV02-STG-01', 'PSV02/STG/01') RETURNING location_id INTO l_stg;
  INSERT INTO warehouse.locations (facility_id, location_code, location_name, location_type, barcode_value, path_code)
  VALUES (f, 'PSV02-BIN-99', 'PSV02 other bin', 'BIN', 'PSV02-BIN-99', 'PSV02/BIN/99') RETURNING location_id INTO l_bad;
  INSERT INTO warehouse_identity.roles (role_code, role_name, permissions)
  VALUES ('PSV02_TEST_PACKER', 'PSV02 test packer', ARRAY['PACKSHIP_PACK']) RETURNING role_id INTO role;
  INSERT INTO _c VALUES ('facility', f), ('station', st), ('loc_src', l_src), ('loc_stg', l_stg), ('loc_bad', l_bad);

  -- A and B are packers, S is a supervisor without the packing permission, X has an expired session
  FOR u IN SELECT * FROM (VALUES ('a', true, false), ('b', true, false), ('s', false, false), ('x', true, true)) v(tag, packer, expired) LOOP
    DECLARE uid uuid; eid uuid;
    BEGIN
      INSERT INTO warehouse_identity.users (username, display_name) VALUES ('psv02_' || u.tag, 'PSV02 ' || u.tag)
        RETURNING user_id INTO uid;
      INSERT INTO warehouse_identity.employees (user_id, employee_number, facility_id) VALUES (uid, 'PSV02-' || upper(u.tag), f)
        RETURNING employee_id INTO eid;
      INSERT INTO warehouse.devices (facility_id, station_id, device_type, status, device_name, serial_number, hardware_fingerprint)
      VALUES (f, st, 'PWA_IOS', 'ACTIVE', 'PSV02 phone ' || u.tag, 'PSV02-SN-' || u.tag, 'psv02-hw-' || u.tag) RETURNING device_id INTO d;
      INSERT INTO warehouse.device_sessions (device_id, user_id, employee_number) VALUES (d, uid, 'PSV02-' || upper(u.tag))
        RETURNING session_id INTO ds;
      IF u.expired THEN
        INSERT INTO warehouse_identity.auth_sessions (user_id, employee_id, device_id, warehouse_device_session_id,
          authentication_method, token_hash, issued_at, last_activity_at, idle_expires_at, absolute_expires_at, request_id, correlation_id)
        VALUES (uid, eid, d, ds, 'PASSWORD', sha256(convert_to(gen_random_uuid()::text, 'UTF8')), now_ts - interval '2 hours',
          now_ts - interval '1 hour', now_ts - interval '35 minutes', now_ts + interval '5 hours', gen_random_uuid(), gen_random_uuid())
        RETURNING auth_session_id INTO sess;
      ELSE
        INSERT INTO warehouse_identity.auth_sessions (user_id, employee_id, device_id, warehouse_device_session_id,
          authentication_method, token_hash, idle_expires_at, absolute_expires_at, request_id, correlation_id)
        VALUES (uid, eid, d, ds, 'PASSWORD', sha256(convert_to(gen_random_uuid()::text, 'UTF8')),
          clock_timestamp() + interval '20 minutes', clock_timestamp() + interval '4 hours', gen_random_uuid(), gen_random_uuid())
        RETURNING auth_session_id INTO sess;
      END IF;
      IF u.packer THEN
        INSERT INTO warehouse_identity.user_role_assignments (user_id, role_id, facility_id) VALUES (uid, role, f);
      END IF;
      INSERT INTO _c VALUES ('user_' || u.tag, uid), ('device_' || u.tag, d), ('sess_' || u.tag, sess);
    END;
  END LOOP;

  INSERT INTO warehouse.items (facility_id, current_location_id, internal_barcode, status)
  VALUES (f, l_src, 'PSV02-ITEM-0001', 'PICKED') RETURNING item_id INTO i1;
  INSERT INTO warehouse.items (facility_id, current_location_id, internal_barcode, status)
  VALUES (f, l_src, 'PSV02-ITEM-0002', 'PICKED') RETURNING item_id INTO i2;
  INSERT INTO warehouse.items (facility_id, current_location_id, internal_barcode, status)
  VALUES (f, l_src, 'PSV02-ITEM-0003', 'PICKED') RETURNING item_id INTO i3;
  INSERT INTO warehouse.item_identifiers (item_id, identifier_type, identifier_value, normalized_value, verified)
  VALUES (i2, 'UPC', '012345678905', '012345678905', true);
  INSERT INTO warehouse.fulfillment_orders (facility_id, external_order_id, marketplace, order_status, order_created_at)
  VALUES (f, 'PSV02-ORD-1', 'PSV02TEST', 'READY_TO_PACK', now_ts) RETURNING fulfillment_order_id INTO o1;
  INSERT INTO warehouse.fulfillment_order_lines (fulfillment_order_id, item_id, external_line_id) VALUES (o1, i1, 'L1'), (o1, i2, 'L2');
  INSERT INTO warehouse.fulfillment_orders (facility_id, external_order_id, marketplace, order_status, order_created_at)
  VALUES (f, 'PSV02-ORD-2', 'PSV02TEST', 'READY_TO_PACK', now_ts) RETURNING fulfillment_order_id INTO o2;
  INSERT INTO warehouse.fulfillment_order_lines (fulfillment_order_id, item_id, external_line_id) VALUES (o2, i3, 'L1');
  INSERT INTO warehouse.packaging_profiles (profile_code, profile_name, version, packaging_type_code)
  VALUES ('PSV02-BOX-S', 'PSV02 small box', 1, 'BOX') RETURNING packaging_profile_id INTO prof;
  INSERT INTO _c VALUES ('item1', i1), ('item2', i2), ('item3', i3), ('order1', o1), ('order2', o2), ('profile', prof);
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Main flow: create → claim → source → items → package → measure → complete → label pair → stage
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE r jsonb; r2 jsonb; k text; k_create text := pg_temp.k(); task uuid; rv bigint; e text; n0 bigint; n1 bigint;
  sa uuid := pg_temp.u('sess_a'); sb uuid := pg_temp.u('sess_b'); ss uuid := pg_temp.u('sess_s'); sx uuid := pg_temp.u('sess_x');
  pkg uuid; prv bigint; ov uuid; ov_self uuid; ship uuid := gen_random_uuid(); ho uuid; pj uuid; ev jsonb; pkgno text;
BEGIN
  -- T01-T04 create + idempotency + one active task per order
  r := warehouse.packship_create_task_v2(pg_temp.u('order1'), NULL, NULL, NULL, NULL, k_create, gen_random_uuid(), gen_random_uuid());
  task := (r->'task'->>'packingTaskId')::uuid; INSERT INTO _c VALUES ('task1', task);
  PERFORM pg_temp.t('T01 create task: READY with 2 items',
    r->>'ok' = 'true' AND r->'task'->>'status' = 'READY' AND jsonb_array_length(r->'task'->'items') = 2, r->'task'->>'taskNumber');
  r2 := warehouse.packship_create_task_v2(pg_temp.u('order1'), NULL, NULL, NULL, NULL, k_create, gen_random_uuid(), gen_random_uuid());
  PERFORM pg_temp.t('T02 create replay: same task, replayed=true',
    r2->>'replayed' = 'true' AND (r2->'task'->>'packingTaskId')::uuid = task);
  e := pg_temp.err(format('SELECT warehouse.packship_create_task_v2(%L, NULL, NULL, 90::smallint, NULL, %L, NULL, NULL)', pg_temp.u('order1'), k_create));
  PERFORM pg_temp.t('T03 create same key, different input: KEY_REUSED', e = 'PACKSHIP_IDEMPOTENCY_KEY_REUSED', e);
  e := pg_temp.err(format('SELECT warehouse.packship_create_task_v2(%L, NULL, NULL, NULL, NULL, %L, NULL, NULL)', pg_temp.u('order1'), pg_temp.k()));
  PERFORM pg_temp.t('T04 second task for same order: ACTIVE_TASK_EXISTS', e = 'PACKSHIP_ACTIVE_TASK_EXISTS', e);

  -- T05-T08 identity and claims
  e := pg_temp.err(format('SELECT warehouse.packship_claim_task_v2(%L, %L, %L, NULL, NULL)', sx, task, pg_temp.k()));
  PERFORM pg_temp.t('T05 expired session: SESSION_INVALID', e = 'PACKSHIP_SESSION_INVALID', e);
  e := pg_temp.err(format('SELECT warehouse.packship_claim_task_v2(%L, %L, %L, NULL, NULL)', ss, task, pg_temp.k()));
  PERFORM pg_temp.t('T06 user without PACKSHIP_PACK: ACTOR_NOT_ALLOWED', e = 'PACKSHIP_ACTOR_NOT_ALLOWED', e);
  e := pg_temp.err(format('SELECT warehouse.packship_claim_task_v2(%L, %L, %L, NULL, NULL)', gen_random_uuid(), task, pg_temp.k()));
  PERFORM pg_temp.t('T07 unknown session id: SESSION_INVALID', e = 'PACKSHIP_SESSION_INVALID', e);
  r := warehouse.packship_claim_task_v2(sa, task, pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T08 A claims: CLAIMED, heldBySession',
    r->'task'->>'status' = 'CLAIMED' AND r->'task'->'claim'->>'heldBySession' = 'true');
  e := pg_temp.err(format('SELECT warehouse.packship_claim_task_v2(%L, %L, %L, NULL, NULL)', sb, task, pg_temp.k()));
  PERFORM pg_temp.t('T09 B claims live claim: CLAIMED_BY_OTHER', e = 'PACKSHIP_TASK_CLAIMED_BY_OTHER', e);
  rv := pg_temp.rv(task);
  e := pg_temp.err(format('SELECT warehouse.packship_verify_source_v2(%L, %L, %s, %L, NULL, %L, NULL, NULL)', sb, task, rv, 'PSV02-SRC-01', pg_temp.k()));
  PERFORM pg_temp.t('T10 B scans source on A''s task: CLAIMED_BY_OTHER', e = 'PACKSHIP_TASK_CLAIMED_BY_OTHER', e);
  e := pg_temp.err(format('SELECT warehouse.packship_verify_source_v2(%L, %L, %s, %L, NULL, %L, NULL, NULL)', sa, task, rv - 1, 'PSV02-SRC-01', pg_temp.k()));
  PERFORM pg_temp.t('T11 stale row version: ROW_VERSION_CONFLICT', e = 'PACKSHIP_ROW_VERSION_CONFLICT', e);

  -- T12-T14 source scan: wrong (kept as evidence), replay, right
  k := pg_temp.k();
  SELECT count(*) INTO n0 FROM warehouse_telemetry.barcode_scan_events WHERE facility_id = pg_temp.u('facility');
  r := warehouse.packship_verify_source_v2(sa, task, rv, 'NOT-A-REAL-BARCODE', '{"source":"CAMERA","symbology":"CODE128"}', k, NULL, NULL);
  PERFORM pg_temp.t('T12 wrong source: ok=false WRONG_SOURCE, scan kept, row version unchanged',
    r->>'ok' = 'false' AND r->>'code' = 'WRONG_SOURCE' AND (r->>'scanEventId') IS NOT NULL AND pg_temp.rv(task) = rv, r->>'scanResult');
  r2 := warehouse.packship_verify_source_v2(sa, task, rv, 'NOT-A-REAL-BARCODE', '{"source":"CAMERA","symbology":"CODE128"}', k, NULL, NULL);
  SELECT count(*) INTO n1 FROM warehouse_telemetry.barcode_scan_events WHERE facility_id = pg_temp.u('facility');
  PERFORM pg_temp.t('T13 replay of rejected scan: same answer, no new scan event',
    r2->>'replayed' = 'true' AND r2->>'scanEventId' = r->>'scanEventId' AND n1 = n0 + 1, format('events %s->%s', n0, n1));
  e := pg_temp.err(format('SELECT warehouse.packship_verify_source_v2(%L, %L, %s, %L, NULL, %L, NULL, NULL)', sa, task, rv, 'SOMETHING-ELSE', k));
  PERFORM pg_temp.t('T14 same key, different barcode: KEY_REUSED', e = 'PACKSHIP_IDEMPOTENCY_KEY_REUSED', e);
  r := warehouse.packship_verify_source_v2(sa, task, rv, 'psv02 src 01', '{"source":"HID"}', pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T15 source = location holding all items (normalized): CONTENTS_VERIFYING',
    r->>'ok' = 'true' AND r->'task'->>'status' = 'CONTENTS_VERIFYING' AND r->'task'->>'sourceVerified' = 'true');

  -- T16-T19 items
  rv := pg_temp.rv(task);
  r := warehouse.packship_verify_item_v2(sa, task, rv, 'PSV02-BIN-99', NULL, pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T16 wrong item: ok=false WRONG_ITEM', r->>'ok' = 'false' AND r->>'code' = 'WRONG_ITEM', r->>'scanResult');
  r := warehouse.packship_verify_item_v2(sa, task, rv, 'PSV02-ITEM-0001', NULL, pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T17 item 1 verified, task still CONTENTS_VERIFYING',
    r->>'ok' = 'true' AND r->'task'->>'status' = 'CONTENTS_VERIFYING' AND pg_temp.rv(task) = rv + 1);
  rv := pg_temp.rv(task);
  r := warehouse.packship_verify_item_v2(sa, task, rv, 'PSV02-ITEM-0001', NULL, pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T18 item 1 again: ok=false ITEM_ALREADY_VERIFIED', r->>'code' = 'ITEM_ALREADY_VERIFIED', r->>'scanResult');
  r := warehouse.packship_verify_item_v2(sa, task, rv, '0012345678905', '{"source":"CAMERA","symbology":"EAN13"}', pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T19 item 2 by EAN-13 form of its UPC-A: all verified → PACKING',
    r->>'ok' = 'true' AND r->'task'->>'status' = 'PACKING', r->'task'->>'status');

  -- T20-T25 package + measurements
  rv := pg_temp.rv(task);
  r := warehouse.packship_select_package_v2(sa, task, rv, pg_temp.u('profile'), NULL, pg_temp.k(), NULL, NULL);
  pkg := (r->>'packageId')::uuid; pkgno := r->'task'->'package'->>'packageNumber'; prv := (r->'task'->'package'->>'rowVersion')::bigint;
  PERFORM pg_temp.t('T20 select package: MEASURING, TCDS-PKG number', r->'task'->>'status' = 'MEASURING' AND pkgno LIKE 'TCDS-PKG-%', pkgno);
  rv := pg_temp.rv(task);
  e := pg_temp.err(format('SELECT warehouse.packship_record_measurements_v2(%L, %L, %s, %L, %s, 12.5, 10, 8, 4, %L, %L, NULL, NULL)',
    sa, task, rv, pkg, prv, '{"type":"MANUAL"}', pg_temp.k()));
  PERFORM pg_temp.t('T21 manual weight without override: PRECONDITION_FAILED', e = 'PACKSHIP_PRECONDITION_FAILED', e);
  INSERT INTO warehouse.packing_override_decisions (packing_task_id, package_id, override_level, decision_type, status,
    reason_code, reason, requested_by, approved_by, correlation_id, decided_at)
  VALUES (task, pkg, 'SUPERVISOR', 'MANUAL_WEIGHT', 'APPROVED', 'NO_SCALE', 'pilot has no scale', pg_temp.u('user_a'),
    pg_temp.u('user_a'), gen_random_uuid(), clock_timestamp()) RETURNING packing_override_decision_id INTO ov_self;
  e := pg_temp.err(format('SELECT warehouse.packship_record_measurements_v2(%L, %L, %s, %L, %s, 12.5, 10, 8, 4, %L, %L, NULL, NULL)',
    sa, task, rv, pkg, prv, jsonb_build_object('type', 'MANUAL', 'overrideDecisionId', ov_self), pg_temp.k()));
  PERFORM pg_temp.t('T22 self-approved override is refused', e = 'PACKSHIP_PRECONDITION_FAILED', e);
  INSERT INTO warehouse.packing_override_decisions (packing_task_id, package_id, override_level, decision_type, status,
    reason_code, reason, requested_by, approved_by, correlation_id, decided_at)
  VALUES (task, pkg, 'SUPERVISOR', 'MANUAL_WEIGHT', 'APPROVED', 'NO_SCALE', 'pilot has no scale', pg_temp.u('user_a'),
    pg_temp.u('user_s'), gen_random_uuid(), clock_timestamp()) RETURNING packing_override_decision_id INTO ov;
  e := pg_temp.err(format('SELECT warehouse.packship_record_measurements_v2(%L, %L, %s, %L, %s, 12.5, 10, 8, 4, %L, %L, NULL, NULL)',
    sa, task, rv, pkg, prv + 5, jsonb_build_object('type', 'MANUAL', 'overrideDecisionId', ov), pg_temp.k()));
  PERFORM pg_temp.t('T23 stale package row version: ROW_VERSION_CONFLICT', e = 'PACKSHIP_ROW_VERSION_CONFLICT', e);
  r := warehouse.packship_record_measurements_v2(sa, task, rv, pkg, prv, 12.5, 10, 8, 4,
    jsonb_build_object('type', 'MANUAL', 'overrideDecisionId', ov), pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T24 manual weight with supervisor override: EVIDENCE_PENDING, weight stored',
    r->'task'->>'status' = 'EVIDENCE_PENDING' AND (r->'task'->'package'->>'weightOz')::numeric = 12.5);
  prv := (r->'task'->'package'->>'rowVersion')::bigint; rv := pg_temp.rv(task);

  -- T25-T27 complete
  INSERT INTO warehouse.packing_exceptions (packing_task_id, exception_type, reason_code, summary, correlation_id)
  VALUES (task, 'DAMAGE', 'TEST', 'blocking test exception', gen_random_uuid());
  e := pg_temp.err(format('SELECT warehouse.packship_complete_task_v2(%L, %L, %s, %L, %s, %L, NULL, NULL)', sa, task, rv, pkg, prv, pg_temp.k()));
  PERFORM pg_temp.t('T25 open blocking exception blocks completion', e = 'PACKSHIP_PRECONDITION_FAILED', e);
  UPDATE warehouse.packing_exceptions SET status = 'RESOLVED', resolved_at = clock_timestamp() WHERE packing_task_id = task;
  k := pg_temp.k();
  r := warehouse.packship_complete_task_v2(sa, task, rv, pkg, prv, k, NULL, NULL);
  PERFORM pg_temp.t('T26 complete: PACKED, package PACKED, 2 package_items, items PACKED',
    r->'task'->>'status' = 'PACKED' AND r->'task'->'package'->>'status' = 'PACKED'
    AND (SELECT count(*) FROM warehouse.package_items WHERE package_id = pkg) = 2
    AND (SELECT count(*) FROM warehouse.items WHERE item_id IN (pg_temp.u('item1'), pg_temp.u('item2')) AND status::text = 'PACKED') = 2);
  r2 := warehouse.packship_complete_task_v2(sa, task, rv, pkg, prv, k, NULL, NULL);
  PERFORM pg_temp.t('T27 complete replay (response lost): replayed, no double write',
    r2->>'replayed' = 'true' AND (SELECT count(*) FROM warehouse.package_items WHERE package_id = pkg) = 2);

  -- T28-T34 label pair
  e := pg_temp.err(format('SELECT warehouse.packship_verify_label_pair_v2(%L, %L, %L, %L, NULL, NULL, %L, NULL, NULL)', sa, ship, '1Z999', pkgno, pg_temp.k()));
  PERFORM pg_temp.t('T28 unknown shipment: SHIPMENT_NOT_FOUND', e = 'PACKSHIP_SHIPMENT_NOT_FOUND', e);
  INSERT INTO warehouse.shipping_handoffs (package_id, shipment_id, carrier_code, service_code, tracking_number, status)
  VALUES (pkg, ship, 'UPS', 'GROUND', '1Z 999 AA1 01 2345 6784', 'LABEL_PURCHASED') RETURNING shipping_handoff_id INTO ho;
  e := pg_temp.err(format('SELECT warehouse.packship_verify_label_pair_v2(%L, %L, %L, %L, NULL, NULL, %L, NULL, NULL)', sa, ship, '1Z999AA10123456784', pkgno, pg_temp.k()));
  PERFORM pg_temp.t('T29 no printed label: LABEL_NOT_PRINTED', e = 'PACKSHIP_PRECONDITION_FAILED', e);
  INSERT INTO warehouse_control.print_jobs (facility_id, job_type, status, package_id, shipping_handoff_id, idempotency_key, completed_at)
  VALUES (pg_temp.u('facility'), 'SHIPPING_LABEL', 'PRINTED', pkg, ho, pg_temp.k(), clock_timestamp()) RETURNING print_job_id INTO pj;
  r := warehouse.packship_verify_label_pair_v2(sa, ship, '1Z999AA19999999999', pkgno, NULL, '{"source":"MANUAL"}', pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T30 wrong tracking label: ok=false TRACKING_MISMATCH, both scans kept',
    r->>'code' = 'TRACKING_MISMATCH' AND r->>'trackingScanEventId' IS NOT NULL AND r->>'packageScanEventId' IS NOT NULL
    AND r->'task'->>'status' = 'PACKED');
  r := warehouse.packship_verify_label_pair_v2(sa, ship, '1Z999AA10123456784', 'TCDS-PKG-WRONG', NULL, NULL, pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T31 wrong package label: ok=false PACKAGE_MISMATCH', r->>'code' = 'PACKAGE_MISMATCH');
  ev := jsonb_build_object('labelPairId', 'lp-1', 'tracking', jsonb_build_object('labelPairId', 'lp-OTHER', 'barcode', '1Z999AA10123456784'));
  e := pg_temp.err(format('SELECT warehouse.packship_verify_label_pair_v2(%L, %L, %L, %L, %L, NULL, %L, NULL, NULL)', sa, ship, '1Z999AA10123456784', pkgno, ev, pg_temp.k()));
  PERFORM pg_temp.t('T32 inconsistent physicalEvidence: INPUT_INVALID', e = 'PACKSHIP_INPUT_INVALID', e);
  ev := jsonb_build_object('labelPairId', 'lp-1',
    'tracking', jsonb_build_object('labelPairId', 'lp-1', 'barcode', '1Z999AA10123456784', 'observationId', 'obs-t',
                                   'trackingClientOperationId', 'op-t', 'trackingCorrelationId', 'corr-t'),
    'package', jsonb_build_object('observationId', 'obs-p', 'packageClientOperationId', 'op-p', 'packageCorrelationId', 'corr-p'));
  k := pg_temp.k();
  r := warehouse.packship_verify_label_pair_v2(sa, ship, '1z999aa1 0123456784', lower(pkgno), ev,
    '{"source":"CAMERA","provider":"scandit","symbology":"CODE128"}', k, NULL, NULL);
  PERFORM pg_temp.t('T33 correct pair (normalized): LABEL_VERIFIED, print verified, pair linked',
    r->>'ok' = 'true' AND r->'task'->>'status' = 'LABEL_VERIFIED'
    AND (SELECT result FROM warehouse_control.print_verifications WHERE print_job_id = pj) = 'PASSED'
    AND (SELECT status::text FROM warehouse_control.print_jobs WHERE print_job_id = pj) = 'VERIFIED'
    AND (SELECT tracking_client_operation_id || '/' || package_client_operation_id FROM warehouse.packship_label_pairs
          WHERE label_pair_id = (r->>'labelPairId')::uuid) = 'op-t/op-p', r->>'code');
  r2 := warehouse.packship_verify_label_pair_v2(sa, ship, '1z999aa1 0123456784', lower(pkgno), ev,
    '{"source":"CAMERA","provider":"scandit","symbology":"CODE128"}', k, NULL, NULL);
  PERFORM pg_temp.t('T34 label pair replay: same labelPairId, replayed', r2->>'replayed' = 'true' AND r2->>'labelPairId' = r->>'labelPairId');

  -- T35-T39 stage outbound
  e := pg_temp.err(format('SELECT warehouse.packship_stage_outbound_v2(%L, %L, %L, NULL, %L, NULL, NULL)', sb, ship, 'PSV02-STG-01', pg_temp.k()));
  PERFORM pg_temp.t('T35 B stages A''s task: CLAIMED_BY_OTHER', e = 'PACKSHIP_TASK_CLAIMED_BY_OTHER', e);
  r := warehouse.packship_stage_outbound_v2(sa, ship, 'PSV02-BIN-99', NULL, pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T36 non-staging location: ok=false WRONG_LOCATION', r->>'code' = 'WRONG_LOCATION' AND r->>'scanResult' = 'WRONG_LOCATION');
  k := pg_temp.k();
  r := warehouse.packship_stage_outbound_v2(sa, ship, 'PSV02-STG-01', '{"source":"CAMERA"}', k, NULL, NULL);
  PERFORM pg_temp.t('T37 stage: OUTBOUND_STAGED, event has both label scans, claim released, items SHIP_READY',
    r->'task'->>'status' = 'OUTBOUND_STAGED' AND r->'task'->'claim' = 'null'::jsonb
    AND EXISTS (SELECT 1 FROM warehouse.outbound_staging_events WHERE packing_task_id = task
                 AND package_barcode_scan_event_id IS NOT NULL AND tracking_barcode_scan_event_id IS NOT NULL)
    AND (SELECT count(*) FROM warehouse.items WHERE item_id IN (pg_temp.u('item1'), pg_temp.u('item2')) AND status::text = 'SHIP_READY') = 2,
    r->'task'->>'status');
  r2 := warehouse.packship_stage_outbound_v2(sa, ship, 'PSV02-STG-01', '{"source":"CAMERA"}', k, NULL, NULL);
  PERFORM pg_temp.t('T38 stage replay: replayed, one staging event',
    r2->>'replayed' = 'true' AND (SELECT count(*) FROM warehouse.outbound_staging_events WHERE packing_task_id = task) = 1);
  r := warehouse.packship_get_task_v2(sb, task);
  PERFORM pg_temp.t('T39 read task from same facility: OUTBOUND_STAGED, no blockers',
    r->'task'->>'status' = 'OUTBOUND_STAGED' AND jsonb_array_length(r->'task'->'blockers') = 0, (r->'task'->'blockers')::text);
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Claim expiry, takeover and release (second order)
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE r jsonb; e text; task uuid; sa uuid := pg_temp.u('sess_a'); sb uuid := pg_temp.u('sess_b'); rv bigint;
BEGIN
  r := warehouse.packship_create_task_v2(pg_temp.u('order2'), NULL, pg_temp.u('station'), NULL, NULL, pg_temp.k(), NULL, NULL);
  task := (r->'task'->>'packingTaskId')::uuid;
  PERFORM warehouse.packship_claim_task_v2(sa, task, pg_temp.k(), NULL, NULL);
  UPDATE warehouse.packing_task_claims SET expires_at = clock_timestamp() - interval '1 second'
   WHERE packing_task_id = task AND released_at IS NULL;
  rv := pg_temp.rv(task);
  e := pg_temp.err(format('SELECT warehouse.packship_verify_source_v2(%L, %L, %s, %L, NULL, %L, NULL, NULL)', sb, task, rv, 'PSV02-SRC-01', pg_temp.k()));
  PERFORM pg_temp.t('T40 B acts on expired claim without claiming: CLAIM_REQUIRED', e = 'PACKSHIP_CLAIM_REQUIRED', e);
  r := warehouse.packship_claim_task_v2(sb, task, pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T41 B takes over expired claim', r->>'takeover' = 'true' AND r->'task'->'claim'->>'heldBySession' = 'true'
    AND (SELECT count(*) FROM warehouse.packing_task_claims WHERE packing_task_id = task) = 2);
  rv := pg_temp.rv(task);
  e := pg_temp.err(format('SELECT warehouse.packship_verify_source_v2(%L, %L, %s, %L, NULL, %L, NULL, NULL)', sa, task, rv, 'PSV02-SRC-01', pg_temp.k()));
  PERFORM pg_temp.t('T42 A after takeover: CLAIMED_BY_OTHER', e = 'PACKSHIP_TASK_CLAIMED_BY_OTHER', e);
  r := warehouse.packship_release_task_v2(sb, task, rv, 'switching task', pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T43 B releases: back to READY, no claim', r->'task'->>'status' = 'READY' AND r->'task'->'claim' = 'null'::jsonb);
  UPDATE warehouse.devices SET station_id = NULL WHERE device_id = pg_temp.u('device_a');
  e := pg_temp.err(format('SELECT warehouse.packship_claim_task_v2(%L, %L, %L, NULL, NULL)', sa, task, pg_temp.k()));
  PERFORM pg_temp.t('T44 device at another station than the task: STATION_MISMATCH', e = 'PACKSHIP_STATION_MISMATCH', e);
  UPDATE warehouse.devices SET station_id = pg_temp.u('station') WHERE device_id = pg_temp.u('device_a');
  UPDATE warehouse.devices SET status = 'DISABLED' WHERE device_id = pg_temp.u('device_a');
  e := pg_temp.err(format('SELECT warehouse.packship_claim_task_v2(%L, %L, %L, NULL, NULL)', sa, task, pg_temp.k()));
  PERFORM pg_temp.t('T45 disabled device: ACTOR_NOT_ALLOWED', e = 'PACKSHIP_ACTOR_NOT_ALLOWED', e);
  UPDATE warehouse.devices SET status = 'ACTIVE' WHERE device_id = pg_temp.u('device_a');
  UPDATE warehouse_identity.auth_sessions SET revoked_at = clock_timestamp(), revoked_by = pg_temp.u('user_s'), revocation_reason = 'test'
   WHERE auth_session_id = sa;
  e := pg_temp.err(format('SELECT warehouse.packship_get_task_v2(%L, %L)', sa, task));
  PERFORM pg_temp.t('T46 revoked session cannot even read: SESSION_INVALID', e = 'PACKSHIP_SESSION_INVALID', e);
  e := pg_temp.err(format('SELECT warehouse.packship_claim_task_v2(%L, %L, %L, NULL, NULL)', sb, task, 'short'));
  PERFORM pg_temp.t('T47 idempotency key too short: KEY_INVALID', e = 'PACKSHIP_IDEMPOTENCY_KEY_INVALID', e);
  e := pg_temp.err('UPDATE warehouse.packship_operations SET result_code = ''X''');
  PERFORM pg_temp.t('T48 idempotency ledger is append-only', e <> 'NO_ERROR', e);
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text || '→' || r.rolname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) r
   WHERE n.nspname = 'warehouse' AND (p.proname LIKE 'packship\_\_%' OR p.proname LIKE 'packship\_%\_v2')
     AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');
  PERFORM pg_temp.t('T49 anon/authenticated/service_role cannot execute any V0.2 function', v_bad IS NULL, v_bad);
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'warehouse' AND (p.proname LIKE 'packship\_\_%' OR p.proname LIKE 'packship\_%\_v2')
     AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0);
  PERFORM pg_temp.t('T50 nothing in V0.2 is executable by PUBLIC', v_bad IS NULL, v_bad);
  PERFORM pg_temp.t('T51 tcds_packship_api: operator functions yes, create no, helpers no',
    has_function_privilege('tcds_packship_api', 'warehouse.packship_claim_task_v2(uuid,uuid,text,uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('tcds_packship_api', 'warehouse.packship_stage_outbound_v2(uuid,uuid,text,jsonb,text,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('tcds_packship_api', 'warehouse.packship_create_task_v2(uuid,uuid,uuid,smallint,timestamptz,text,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('tcds_packship_api', 'warehouse.packship__actor(uuid)', 'EXECUTE'));
  PERFORM pg_temp.t('T52 tcds_packship_system: create only',
    has_function_privilege('tcds_packship_system', 'warehouse.packship_create_task_v2(uuid,uuid,uuid,smallint,timestamptz,text,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('tcds_packship_system', 'warehouse.packship_claim_task_v2(uuid,uuid,text,uuid,uuid)', 'EXECUTE'));
  PERFORM pg_temp.t('T53 no table privileges on the new tables for the API roles',
    NOT has_table_privilege('tcds_packship_api', 'warehouse.packship_operations', 'SELECT')
    AND NOT has_table_privilege('tcds_packship_api', 'warehouse.packing_tasks', 'UPDATE'));
END $$;

-- As the API role itself: the function works, direct table access does not
DO $$
DECLARE r jsonb; e text; v_task uuid := pg_temp.u('task1'); v_sess uuid := pg_temp.u('sess_b');
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE tcds_packship_api';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.t('T54 call as tcds_packship_api (SKIPPED: this login cannot SET ROLE to it)', true);
    RETURN;
  END;
  r := warehouse.packship_get_task_v2(v_sess, v_task);
  e := pg_temp.err('SELECT count(*) FROM warehouse.packing_tasks');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.t('T54 as tcds_packship_api: get_task works, direct SELECT on packing_tasks denied',
    r->>'ok' = 'true' AND e LIKE 'permission denied%', e);
END $$;

SELECT format('%s %s%s', CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END, test, CASE WHEN pass OR detail IS NULL THEN '' ELSE '  [' || detail || ']' END)
  FROM _r ORDER BY n;
SELECT format('SUMMARY: %s passed, %s failed, %s total', count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass), count(*)) FROM _r;
