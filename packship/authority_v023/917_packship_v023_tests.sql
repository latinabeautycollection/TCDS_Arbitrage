-- =====================================================================================================================
-- 917  Pack/Ship V0.2.3 tests (manualWeightApproval in the task snapshot). Run in the SAME transaction AFTER 916,
-- 911, 913 and 915 (which leave task2 MEASURING with an OPEN package, claimed by session B). Then ROLLBACK. T96+.
-- =====================================================================================================================
DELETE FROM _r;

DO $$
DECLARE s jsonb; r jsonb; e text; t2 uuid := pg_temp.u('task2'); sb uuid := pg_temp.u('sess_b');
  ua uuid := pg_temp.u('user_a'); ub uuid := pg_temp.u('user_b'); us uuid := pg_temp.u('user_s');
  pkg uuid; prv bigint; d_self uuid; d_req uuid; d_other_pkg uuid; d_old uuid; d_ok uuid; d_exp uuid;
  v021 text[] := ARRAY['packingTaskId','taskNumber','status','rowVersion','facilityId','assignedStationId',
    'fulfillmentOrderId','claim','sourceVerified','items','package','shipment','blockers','snapshotVersion',
    'carrierCutoffAt','facility','station','order','evidence','stationReadiness','printJob'];
BEGIN
  s := warehouse.packship_get_task_v2(sb, t2)->'task';
  pkg := (s->'package'->>'packageId')::uuid; prv := (s->'package'->>'rowVersion')::bigint;
  PERFORM pg_temp.t('T96 every 0.2.1 key kept, snapshotVersion still 0.2.1, new key present',
    s ?& v021 AND s->>'snapshotVersion' = '0.2.1' AND s ? 'manualWeightApproval', s->>'status');
  PERFORM pg_temp.t('T97 no decision: manualWeightApproval null', s->'manualWeightApproval' = 'null'::jsonb);

  INSERT INTO warehouse.packing_override_decisions (packing_task_id, package_id, override_level, decision_type, status,
    reason_code, reason, requested_by, approved_by, correlation_id, decided_at)
  VALUES (t2, pkg, 'SUPERVISOR', 'MANUAL_WEIGHT', 'APPROVED', 'NO_SCALE', 'self', ub, ub, gen_random_uuid(), clock_timestamp())
  RETURNING packing_override_decision_id INTO d_self;
  INSERT INTO warehouse.packing_override_decisions (packing_task_id, package_id, override_level, decision_type, status,
    reason_code, reason, requested_by, correlation_id)
  VALUES (t2, pkg, 'SUPERVISOR', 'MANUAL_WEIGHT', 'REQUESTED', 'NO_SCALE', 'not decided', ub, gen_random_uuid())
  RETURNING packing_override_decision_id INTO d_req;
  INSERT INTO warehouse.packing_override_decisions (packing_task_id, package_id, override_level, decision_type, status,
    reason_code, reason, requested_by, approved_by, correlation_id, decided_at, expires_at)
  VALUES (t2, pkg, 'SUPERVISOR', 'MANUAL_WEIGHT', 'APPROVED', 'NO_SCALE', 'expired', ub, ua, gen_random_uuid(),
          clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour')
  RETURNING packing_override_decision_id INTO d_exp;
  s := warehouse.packship_get_task_v2(sb, t2)->'task';
  PERFORM pg_temp.t('T98 self-approved, requested-only and expired decisions are not offered',
    s->'manualWeightApproval' = 'null'::jsonb, s->>'manualWeightApproval');

  INSERT INTO warehouse.packing_override_decisions (packing_task_id, package_id, override_level, decision_type, status,
    reason_code, reason, requested_by, approved_by, correlation_id, decided_at)
  VALUES (t2, NULL, 'SUPERVISOR', 'OTHER_TYPE', 'APPROVED', 'X', 'other type', ub, ua, gen_random_uuid(), clock_timestamp());
  s := warehouse.packship_get_task_v2(sb, t2)->'task';
  PERFORM pg_temp.t('T99 a decision of another type is not offered', s->'manualWeightApproval' = 'null'::jsonb);

  INSERT INTO warehouse.packing_override_decisions (packing_task_id, package_id, override_level, decision_type, status,
    reason_code, reason, requested_by, approved_by, correlation_id, decided_at)
  VALUES (t2, NULL, 'SUPERVISOR', 'MANUAL_WEIGHT', 'APPROVED', 'NO_SCALE', 'older task-level', ub, us, gen_random_uuid(),
          clock_timestamp() - interval '10 minutes')
  RETURNING packing_override_decision_id INTO d_old;
  INSERT INTO warehouse.packing_override_decisions (packing_task_id, package_id, override_level, decision_type, status,
    reason_code, reason, requested_by, approved_by, correlation_id, decided_at)
  VALUES (t2, pkg, 'SUPERVISOR', 'MANUAL_WEIGHT', 'APPROVED', 'NO_SCALE', 'pilot has no scale', ub, ua, gen_random_uuid(),
          clock_timestamp())
  RETURNING packing_override_decision_id INTO d_ok;
  s := warehouse.packship_get_task_v2(sb, t2)->'task';
  PERFORM pg_temp.t('T100 approved by another user: latest one offered with id, decidedAt, reasonCode',
    (s->'manualWeightApproval'->>'overrideDecisionId')::uuid = d_ok AND s->'manualWeightApproval' ? 'decidedAt'
    AND s->'manualWeightApproval'->>'reasonCode' = 'NO_SCALE', s->>'manualWeightApproval');

  UPDATE warehouse.packing_override_decisions SET revoked_at = clock_timestamp(), status = 'REVOKED'
   WHERE packing_override_decision_id = d_ok;
  s := warehouse.packship_get_task_v2(sb, t2)->'task';
  PERFORM pg_temp.t('T101 latest revoked: falls back to the older valid task-level approval',
    (s->'manualWeightApproval'->>'overrideDecisionId')::uuid = d_old, s->>'manualWeightApproval');

  -- the id offered is accepted by record_measurements as is
  r := warehouse.packship_record_measurements_v2(sb, t2, pg_temp.rv(t2), pkg, prv, 12.5, 10, 8, 4,
    jsonb_build_object('type', 'MANUAL', 'overrideDecisionId', s->'manualWeightApproval'->>'overrideDecisionId'), pg_temp.k(), NULL, NULL);
  PERFORM pg_temp.t('T102 the offered id is accepted by record_measurements: EVIDENCE_PENDING, weight stored',
    r->>'ok' = 'true' AND r->'task'->>'status' = 'EVIDENCE_PENDING' AND (r->'task'->'package'->>'weightOz')::numeric = 12.5,
    r->>'code');
  PERFORM pg_temp.t('T103 operation results carry the key too', r->'task' ? 'manualWeightApproval');
END $$;

DO $$
BEGIN
  PERFORM pg_temp.t('T104 packship__snapshot: owner postgres, no grants beyond the owner',
    (SELECT pg_get_userbyid(proowner) = 'postgres' AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(proacl, acldefault('f', proowner))) x
        WHERE x.grantee <> proowner)
       FROM pg_proc WHERE oid = 'warehouse.packship__snapshot(uuid, warehouse.packship_actor_t)'::regprocedure));
  PERFORM pg_temp.t('T105 API role has no access to packing_override_decisions',
    NOT has_table_privilege('tcds_packship_api', 'warehouse.packing_override_decisions', 'SELECT'));
END $$;

SELECT format('%s %s%s', CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END, test, CASE WHEN pass OR detail IS NULL THEN '' ELSE '  [' || detail || ']' END)
  FROM _r ORDER BY n;
SELECT format('SUMMARY V0.2.3: %s passed, %s failed, %s total', count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass), count(*)) FROM _r;
