-- =====================================================================================================================
-- 912  Pack/Ship V0.2.1: additive task snapshot. Replaces warehouse.packship__snapshot (same signature, same owner,
-- same grants) so that every V0.2 result and packship_get_task_v2 also carry what the route mapper needs, and the
-- mapper never reads tables (tcds_packship_api has no table access, by design).
--
-- Every V0.2 key is unchanged. New keys:
--   snapshotVersion   '0.2.1'
--   carrierCutoffAt   packing_tasks.carrier_cutoff_at
--   facility          { facilityCode }
--   station           { stationCode }                     null when no station is assigned (or it is in another facility)
--   order             { externalOrderId, shipByAt }       null if the order is not in the task's facility
--   items[].title     product_profiles.title              null when the item has no product profile
--   evidence          { requirementCount, required, accepted, pending, rejected, integrityVerified }
--                     blocking requirements only, VOIDED excluded; pending = not ACCEPTED/OVERRIDDEN;
--                     integrityVerified is false when there are no requirements
--   stationReadiness  { ready, evaluatedAt, ageSeconds, readinessScore, blockingFailures, reasons }
--                     null when no readiness row exists; ageSeconds is measured on the database clock
--   printJob          latest print job for the shipment's handoff: { printJobId, jobType, status, attemptCount,
--                     completedAt, updatedAt }; null when there is no handoff or no print job
-- No table, grant or other function changes.
-- =====================================================================================================================
CREATE OR REPLACE FUNCTION warehouse.packship__snapshot(p_task_id uuid, p_actor warehouse.packship_actor_t)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t warehouse.packing_tasks%ROWTYPE; c warehouse.packing_task_claims%ROWTYPE;
  p warehouse.packages%ROWTYPE; h warehouse.shipping_handoffs%ROWTYPE;
  v_items jsonb; v_now timestamptz := clock_timestamp();
  v_facility_code text; v_station_code text; v_order jsonb; v_evidence jsonb; v_ready jsonb; v_print jsonb;
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
    'printJob', v_print);
END $$;
