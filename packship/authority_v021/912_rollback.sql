-- 912 ROLLBACK: restores warehouse.packship__snapshot exactly as 910 (V0.2) defined it. Owner and grants are kept by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION warehouse.packship__snapshot(p_task_id uuid, p_actor warehouse.packship_actor_t)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t warehouse.packing_tasks%ROWTYPE; c warehouse.packing_task_claims%ROWTYPE;
  p warehouse.packages%ROWTYPE; h warehouse.shipping_handoffs%ROWTYPE;
  v_items jsonb; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO t FROM warehouse.packing_tasks WHERE packing_task_id = p_task_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM warehouse.packing_task_claims WHERE packing_task_id = p_task_id AND released_at IS NULL;
  p := warehouse.packship__current_package(p_task_id);
  IF p.package_id IS NOT NULL THEN SELECT * INTO h FROM warehouse.shipping_handoffs WHERE package_id = p.package_id; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'packingTaskItemId', i.packing_task_item_id, 'itemId', i.item_id, 'expectedBarcode', i.expected_item_barcode,
           'expectedQuantity', i.expected_quantity, 'verifiedQuantity', i.verified_quantity, 'status', i.status,
           'rowVersion', i.row_version) ORDER BY i.packing_task_item_id), '[]'::jsonb)
    INTO v_items FROM warehouse.packing_task_items i WHERE i.packing_task_id = p_task_id;
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
    'blockers', to_jsonb(warehouse.packship__blockers(p_task_id)));
END $$;
