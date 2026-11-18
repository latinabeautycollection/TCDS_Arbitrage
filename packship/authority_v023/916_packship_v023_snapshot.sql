-- =====================================================================================================================
-- 916  Pack/Ship V0.2.3: the task snapshot also carries manualWeightApproval, so the PWA Measurements control can
-- send the overrideDecisionId that packship_record_measurements_v2 already requires for a manual weight (the pilot has
-- no scale). Replaces warehouse.packship__snapshot (same signature, owner and grants; built on the 912 version).
--   manualWeightApproval  { overrideDecisionId, decidedAt, expiresAt, reasonCode } or null. Exactly the decisions
--                         record_measurements would accept from this caller: MANUAL_WEIGHT, APPROVED, not revoked,
--                         not expired, approved by someone other than the caller, task-level or for the current package.
-- Every 0.2.1 key is unchanged (snapshotVersion stays '0.2.1'; the key is additive). No table, grant or other changes.
-- =====================================================================================================================
DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc
       WHERE oid = 'warehouse.packship__snapshot(uuid, warehouse.packship_actor_t)'::regprocedure)
     <> 'a51baa49f4b6af575571dcf74371a23f' THEN
    RAISE EXCEPTION 'packship__snapshot is not the V0.2.1 (912) version this migration was built on - stopping';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION warehouse.packship__snapshot(p_task_id uuid, p_actor warehouse.packship_actor_t)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t warehouse.packing_tasks%ROWTYPE; c warehouse.packing_task_claims%ROWTYPE;
  p warehouse.packages%ROWTYPE; h warehouse.shipping_handoffs%ROWTYPE;
  v_items jsonb; v_now timestamptz := clock_timestamp();
  v_facility_code text; v_station_code text; v_order jsonb; v_evidence jsonb; v_ready jsonb; v_print jsonb;
  v_mw jsonb;  -- V0.2.3
BEGIN
  SELECT * INTO t FROM warehouse.packing_tasks WHERE packing_task_id = p_task_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM warehouse.packing_task_claims WHERE packing_task_id = p_task_id AND released_at IS NULL;
  p := warehouse.packship__current_package(p_task_id);
  IF p.package_id IS NOT NULL THEN SELECT * INTO h FROM warehouse.shipping_handoffs WHERE package_id = p.package_id; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'packingTaskItemId', i.packing_task_item_id, 'itemId', i.item_id, 'expectedBarcode', i.expected_item_barcode,
           'expectedQuantity', i.expected_quantity, 'verifiedQuantity', i.verified_quantity, 'status', i.status,
           'rowVersion', i.row_version, 'title', pp.title) ORDER BY i.packing_task_item_id), '[]'::jsonb)
    INTO v_items
    FROM warehouse.packing_task_items i
    LEFT JOIN warehouse.items wi ON wi.item_id = i.item_id AND wi.facility_id = t.facility_id
    LEFT JOIN warehouse.product_profiles pp ON pp.product_profile_id = wi.product_profile_id
   WHERE i.packing_task_id = p_task_id;

  SELECT f.facility_code::text INTO v_facility_code FROM warehouse.facilities f WHERE f.facility_id = t.facility_id;
  IF t.assigned_station_id IS NOT NULL THEN
    SELECT s.station_code::text INTO v_station_code FROM warehouse.stations s
     WHERE s.station_id = t.assigned_station_id AND s.facility_id = t.facility_id;
  END IF;
  SELECT jsonb_build_object('externalOrderId', o.external_order_id, 'shipByAt', o.ship_by_at) INTO v_order
    FROM warehouse.fulfillment_orders o WHERE o.fulfillment_order_id = t.fulfillment_order_id AND o.facility_id = t.facility_id;

  SELECT jsonb_build_object(
           'requirementCount', count(*) FILTER (WHERE r.status <> 'VOIDED'),
           'required', coalesce(sum(r.required_count) FILTER (WHERE r.status <> 'VOIDED'), 0),
           'accepted', coalesce(sum(r.accepted_count) FILTER (WHERE r.status <> 'VOIDED'), 0),
           'pending', count(*) FILTER (WHERE r.status NOT IN ('VOIDED', 'ACCEPTED', 'OVERRIDDEN')),
           'rejected', count(*) FILTER (WHERE r.status = 'REJECTED'),
           'integrityVerified', coalesce(bool_and(
               (r.status = 'OVERRIDDEN' AND r.override_id IS NOT NULL)
            OR (r.status = 'ACCEPTED' AND r.accepted_count >= r.required_count
                AND r.sha256_verified IS TRUE AND r.chain_verified IS TRUE)) FILTER (WHERE r.status <> 'VOIDED'), false))
    INTO v_evidence
    FROM warehouse.packing_evidence_requirements r
   WHERE r.packing_task_id = p_task_id AND r.blocking IS TRUE;

  IF t.assigned_station_id IS NOT NULL THEN
    SELECT jsonb_build_object('ready', sr.ready, 'evaluatedAt', sr.evaluated_at,
             'ageSeconds', round(extract(epoch FROM (v_now - sr.evaluated_at))::numeric, 3),
             'readinessScore', sr.readiness_score, 'blockingFailures', sr.blocking_failures, 'reasons', to_jsonb(sr.reasons))
      INTO v_ready
      FROM warehouse_control.station_readiness_current sr WHERE sr.station_id = t.assigned_station_id
     ORDER BY sr.evaluated_at DESC LIMIT 1;
  END IF;

  IF h.shipping_handoff_id IS NOT NULL THEN
    SELECT jsonb_build_object('printJobId', pj.print_job_id, 'jobType', pj.job_type, 'status', pj.status::text,
             'attemptCount', pj.attempt_count, 'completedAt', pj.completed_at, 'updatedAt', pj.updated_at)
      INTO v_print
      FROM warehouse_control.print_jobs pj WHERE pj.shipping_handoff_id = h.shipping_handoff_id
     ORDER BY pj.created_at DESC, pj.print_job_id DESC LIMIT 1;
  END IF;

  -- V0.2.3: the supervisor approval this session could use for a manual weight (same conditions as
  -- packship_record_measurements_v2: APPROVED, not revoked, not expired, approved by someone other than the caller,
  -- for this task and for no package or the current one). Latest decision first.
  SELECT jsonb_build_object('overrideDecisionId', d.packing_override_decision_id, 'decidedAt', d.decided_at,
                            'expiresAt', d.expires_at, 'reasonCode', d.reason_code)
    INTO v_mw
    FROM warehouse.packing_override_decisions d
   WHERE d.packing_task_id = t.packing_task_id AND d.decision_type = 'MANUAL_WEIGHT' AND d.status = 'APPROVED'
     AND d.revoked_at IS NULL AND (d.expires_at IS NULL OR d.expires_at > v_now)
     AND d.approved_by IS NOT NULL AND d.approved_by IS DISTINCT FROM p_actor.user_id
     AND (d.package_id IS NULL OR d.package_id = p.package_id)
   ORDER BY d.decided_at DESC NULLS LAST, d.created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'packingTaskId', t.packing_task_id, 'taskNumber', t.task_number, 'status', t.status, 'rowVersion', t.row_version,
    'facilityId', t.facility_id, 'assignedStationId', t.assigned_station_id, 'fulfillmentOrderId', t.fulfillment_order_id,
    'claim', CASE WHEN c.packing_task_claim_id IS NULL THEN NULL ELSE jsonb_build_object(
        'heldBySession', coalesce(c.employee_id = p_actor.employee_id AND c.device_id = p_actor.device_id
                                  AND c.expires_at > v_now, false),
        'employeeId', c.employee_id, 'deviceId', c.device_id, 'expiresAt', c.expires_at,
        'expired', c.expires_at <= v_now) END,
    'sourceVerified', t.context ? 'sourceVerification',
    'items', v_items,
    'package', CASE WHEN p.package_id IS NULL THEN NULL ELSE jsonb_build_object(
        'packageId', p.package_id, 'packageNumber', p.package_number::text, 'status', p.status, 'rowVersion', p.row_version,
        'weightOz', p.actual_weight_oz, 'lengthIn', p.length_in, 'widthIn', p.width_in, 'heightIn', p.height_in) END,
    'shipment', CASE WHEN h.shipping_handoff_id IS NULL THEN NULL ELSE jsonb_build_object(
        'shipmentId', h.shipment_id, 'shippingHandoffId', h.shipping_handoff_id, 'carrierCode', h.carrier_code,
        'status', h.status, 'trackingPresent', h.tracking_number IS NOT NULL) END,
    'blockers', to_jsonb(warehouse.packship__blockers(p_task_id)))
  || jsonb_build_object(
    'snapshotVersion', '0.2.1',
    'carrierCutoffAt', t.carrier_cutoff_at,
    'facility', jsonb_build_object('facilityCode', v_facility_code),
    'station', CASE WHEN v_station_code IS NULL THEN NULL ELSE jsonb_build_object('stationCode', v_station_code) END,
    'order', v_order,
    'evidence', v_evidence,
    'stationReadiness', v_ready,
    'printJob', v_print,
    'manualWeightApproval', v_mw);  -- V0.2.3
END $$;
