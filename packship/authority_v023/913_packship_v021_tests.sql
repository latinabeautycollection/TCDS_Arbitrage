-- =====================================================================================================================
-- 913  Pack/Ship V0.2.1 snapshot tests. Run in the SAME transaction AFTER 912 and the full V0.2 suite (911), which
-- leaves: task1 OUTBOUND_STAGED with a VERIFIED print job, task for order2 READY at PSV02-PACK-01, session B valid.
-- Then ROLLBACK. Prints its own lines and summary (T55+).
-- =====================================================================================================================
DELETE FROM _r;

DO $$
DECLARE r jsonb; s jsonb; t2 uuid; sb uuid := pg_temp.u('sess_b'); prof uuid; e text;
  v02_keys text[] := ARRAY['packingTaskId','taskNumber','status','rowVersion','facilityId','assignedStationId',
    'fulfillmentOrderId','claim','sourceVerified','items','package','shipment','blockers'];
  new_keys text[] := ARRAY['snapshotVersion','carrierCutoffAt','facility','station','order','evidence','stationReadiness','printJob'];
BEGIN
  SELECT packing_task_id INTO t2 FROM warehouse.packing_tasks WHERE fulfillment_order_id = pg_temp.u('order2');
  INSERT INTO _c VALUES ('task2', t2) ON CONFLICT DO NOTHING;

  -- T55-T58 shape: all V0.2 keys kept, new keys present, item keys kept
  r := warehouse.packship_get_task_v2(sb, t2); s := r->'task';
  PERFORM pg_temp.t('T55 every V0.2 key is still present', s ?& v02_keys,
    (SELECT string_agg(k, ',') FROM unnest(v02_keys) k WHERE NOT s ? k));
  PERFORM pg_temp.t('T56 all new keys present, snapshotVersion 0.2.1',
    s ?& new_keys AND s->>'snapshotVersion' = '0.2.1', (SELECT string_agg(k, ',') FROM unnest(new_keys) k WHERE NOT s ? k));
  PERFORM pg_temp.t('T57 item keys kept and title added',
    s->'items'->0 ?& ARRAY['packingTaskItemId','itemId','expectedBarcode','expectedQuantity','verifiedQuantity','status','rowVersion','title']);

  -- T58-T61 identity metadata
  PERFORM pg_temp.t('T58 facility/station/order codes',
    s->'facility'->>'facilityCode' = 'PSV02-TEST' AND s->'station'->>'stationCode' = 'PSV02-PACK-01'
    AND s->'order'->>'externalOrderId' = 'PSV02-ORD-2' AND s->'order' ? 'shipByAt' AND s ? 'carrierCutoffAt',
    concat_ws(' ', s->'facility', s->'station', s->'order'));
  PERFORM pg_temp.t('T59 item without product profile: title null (not invented)', s->'items'->0->'title' = 'null'::jsonb);
  INSERT INTO warehouse.product_profiles (title, source_system, source_record_id)
  VALUES ('PSV021 Test Phone 128GB', 'PSV021TEST', gen_random_uuid()::text) RETURNING product_profile_id INTO prof;
  UPDATE warehouse.items SET product_profile_id = prof WHERE item_id = pg_temp.u('item3');
  UPDATE warehouse.fulfillment_orders SET ship_by_at = '2026-12-01T17:00:00Z' WHERE fulfillment_order_id = pg_temp.u('order2');
  UPDATE warehouse.packing_tasks SET carrier_cutoff_at = '2026-12-01T16:00:00Z' WHERE packing_task_id = t2;
  s := warehouse.packship_get_task_v2(sb, t2)->'task';
  PERFORM pg_temp.t('T60 title from product profile; ship-by and carrier cutoff returned',
    s->'items'->0->>'title' = 'PSV021 Test Phone 128GB'
    AND (s->'order'->>'shipByAt')::timestamptz = '2026-12-01T17:00:00Z'
    AND (s->>'carrierCutoffAt')::timestamptz = '2026-12-01T16:00:00Z', s->'items'->0->>'title');

  -- T61-T63 evidence
  PERFORM pg_temp.t('T61 no evidence requirements: counts 0, integrityVerified false',
    (s->'evidence'->>'requirementCount')::int = 0 AND (s->'evidence'->>'integrityVerified')::boolean = false, s->>'evidence');
  INSERT INTO warehouse.packing_evidence_requirements (packing_task_id, requirement_code, display_name, required_count,
    accepted_count, status, sha256_verified, chain_verified)
  VALUES (t2, 'PSV021_PHOTO_A', 'Photo A', 1, 1, 'ACCEPTED', true, true),
         (t2, 'PSV021_PHOTO_V', 'Voided', 2, 0, 'VOIDED', false, false);
  s := warehouse.packship_get_task_v2(sb, t2)->'task';
  PERFORM pg_temp.t('T62 one accepted + verified (voided ignored): integrityVerified true',
    (s->'evidence'->>'requirementCount')::int = 1 AND (s->'evidence'->>'required')::int = 1
    AND (s->'evidence'->>'accepted')::int = 1 AND (s->'evidence'->>'pending')::int = 0
    AND (s->'evidence'->>'integrityVerified')::boolean, s->>'evidence');
  INSERT INTO warehouse.packing_evidence_requirements (packing_task_id, requirement_code, display_name, status)
  VALUES (t2, 'PSV021_PHOTO_R', 'Rejected photo', 'REJECTED');
  s := warehouse.packship_get_task_v2(sb, t2)->'task';
  PERFORM pg_temp.t('T63 a rejected requirement: pending 1, rejected 1, integrityVerified false',
    (s->'evidence'->>'pending')::int = 1 AND (s->'evidence'->>'rejected')::int = 1
    AND NOT (s->'evidence'->>'integrityVerified')::boolean, s->>'evidence');

  -- T64-T65 station readiness
  DELETE FROM warehouse_control.station_readiness_current WHERE station_id = pg_temp.u('station');
  s := warehouse.packship_get_task_v2(sb, t2)->'task';
  PERFORM pg_temp.t('T64 no readiness row: stationReadiness null (not assumed ready)', s->'stationReadiness' = 'null'::jsonb);
  INSERT INTO warehouse_control.station_readiness_current (station_id, ready, readiness_score, evaluated_at, reasons)
  VALUES (pg_temp.u('station'), true, 95, clock_timestamp() - interval '30 seconds', ARRAY['OK']);
  s := warehouse.packship_get_task_v2(sb, t2)->'task';
  PERFORM pg_temp.t('T65 readiness row: ready true, ageSeconds about 30 on the DB clock',
    (s->'stationReadiness'->>'ready')::boolean AND (s->'stationReadiness'->>'ageSeconds')::numeric BETWEEN 29 AND 60,
    s->>'stationReadiness');

  -- T66-T67 print job and package identity on the staged task
  s := warehouse.packship_get_task_v2(sb, pg_temp.u('task1'))->'task';
  PERFORM pg_temp.t('T66 staged task: printJob is the label job, status VERIFIED',
    s->'printJob'->>'status' = 'VERIFIED' AND s->'printJob'->>'jobType' = 'SHIPPING_LABEL', s->>'printJob');
  PERFORM pg_temp.t('T67 package identity for seal is in the snapshot (packageId + rowVersion)',
    s->'package'->>'packageId' IS NOT NULL AND (s->'package'->>'rowVersion')::bigint >= 1);
  PERFORM pg_temp.t('T68 task without shipment: printJob null', warehouse.packship_get_task_v2(sb, t2)->'task'->'printJob' = 'null'::jsonb);

  -- T69 every operation result carries the new snapshot (claim goes through packship__result)
  r := warehouse.packship_claim_task_v2(sb, t2, pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T69 operation results carry the 0.2.1 snapshot', r->'task'->>'snapshotVersion' = '0.2.1'
    AND r->'task'->'facility'->>'facilityCode' = 'PSV02-TEST', r->>'code');
END $$;

-- T70-T71 privileges unchanged
DO $$
BEGIN
  PERFORM pg_temp.t('T70 packship__snapshot: owner postgres, no grants beyond the owner',
    (SELECT pg_get_userbyid(proowner) = 'postgres' AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(proacl, acldefault('f', proowner))) x
        WHERE x.grantee <> proowner)
       FROM pg_proc WHERE oid = 'warehouse.packship__snapshot(uuid, warehouse.packship_actor_t)'::regprocedure));
  PERFORM pg_temp.t('T71 API role still has no table access to what the snapshot reads',
    NOT has_table_privilege('tcds_packship_api', 'warehouse.facilities', 'SELECT')
    AND NOT has_table_privilege('tcds_packship_api', 'warehouse.product_profiles', 'SELECT')
    AND NOT has_table_privilege('tcds_packship_api', 'warehouse_control.station_readiness_current', 'SELECT')
    AND NOT has_table_privilege('tcds_packship_api', 'warehouse_control.print_jobs', 'SELECT'));
END $$;

-- T72 as the API role: get_task returns the new fields with no table access
DO $$
DECLARE s jsonb; e text; v_sess uuid := pg_temp.u('sess_b'); v_task uuid := pg_temp.u('task2');
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE tcds_packship_api';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.t('T72 call as tcds_packship_api (SKIPPED: this login cannot SET ROLE to it)', true);
    RETURN;
  END;
  s := warehouse.packship_get_task_v2(v_sess, v_task)->'task';
  e := pg_temp.err('SELECT count(*) FROM warehouse.facilities');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.t('T72 as tcds_packship_api: snapshot has facility code + title, direct SELECT denied',
    s->'facility'->>'facilityCode' = 'PSV02-TEST' AND s->'items'->0->>'title' = 'PSV021 Test Phone 128GB'
    AND e LIKE 'permission denied%', e);
END $$;

SELECT format('%s %s%s', CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END, test, CASE WHEN pass OR detail IS NULL THEN '' ELSE '  [' || detail || ']' END)
  FROM _r ORDER BY n;
SELECT format('SUMMARY V0.2.1: %s passed, %s failed, %s total', count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass), count(*)) FROM _r;
