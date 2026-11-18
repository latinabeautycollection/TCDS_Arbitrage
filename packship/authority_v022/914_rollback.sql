-- 914 rollback: restore the exact V0.2 packship_select_package_v2 (from 910) and drop the V0.2.2 functions.
-- Packages created while 914 was live keep their extra metadata keys (eligibilityRule, eligibilityBasis); nothing reads them.
DROP FUNCTION IF EXISTS warehouse.packship_list_packaging_options_v2(uuid, uuid);

CREATE OR REPLACE FUNCTION warehouse.packship_select_package_v2(p_auth_session_id uuid, p_packing_task_id uuid,
  p_expected_row_version bigint, p_packaging_profile_id uuid, p_reason text, p_idempotency_key text, p_request_id uuid,
  p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a warehouse.packship_actor_t; v_hash bytea; v_replay jsonb; t warehouse.packing_tasks%ROWTYPE;
  pr warehouse.packaging_profiles%ROWTYPE; v_pkg uuid := gen_random_uuid(); v_number text; v_result jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  a := warehouse.packship__actor(p_auth_session_id);
  v_hash := warehouse.packship__hash('SELECT_PACKAGE', jsonb_build_object('task', p_packing_task_id,
    'rv', p_expected_row_version, 'profile', p_packaging_profile_id, 'reason', p_reason));
  v_replay := warehouse.packship__idem_lookup('SELECT_PACKAGE', p_idempotency_key, v_hash, a.user_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  t := warehouse.packship__lock_task(p_packing_task_id, a);
  PERFORM warehouse.packship__require_status(t, ARRAY['PACKING']);
  PERFORM warehouse.packship__check_rv(t.row_version, p_expected_row_version);
  PERFORM warehouse.packship__require_claim(t.packing_task_id, a);
  IF (warehouse.packship__current_package(t.packing_task_id)).package_id IS NOT NULL THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["PACKAGE_ALREADY_SELECTED"]}');
  END IF;
  SELECT * INTO pr FROM warehouse.packaging_profiles
   WHERE packaging_profile_id = p_packaging_profile_id AND active AND effective_at <= v_now
     AND (expires_at IS NULL OR expires_at > v_now);
  IF NOT FOUND THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["PACKAGING_PROFILE_INVALID"]}');
  END IF;

  v_number := 'TCDS-PKG-' || upper(substr(replace(v_pkg::text, '-', ''), 1, 12));
  INSERT INTO warehouse.packages (package_id, fulfillment_order_id, package_number, packing_station_id, status,
    packaging_type_code, metadata)
  VALUES (v_pkg, t.fulfillment_order_id, v_number, a.device_station_id, 'OPEN', pr.packaging_type_code,
    jsonb_build_object('packagingProfileId', pr.packaging_profile_id, 'profileCode', pr.profile_code,
                       'profileVersion', pr.version, 'reason', left(p_reason, 500), 'authority', 'packship_v0.2'));
  INSERT INTO warehouse.packing_task_packages (packing_task_id, package_id, relationship_type, linked_by, correlation_id)
  VALUES (t.packing_task_id, v_pkg, 'CREATED', a.user_id, coalesce(p_correlation_id, t.correlation_id));
  INSERT INTO warehouse_control.barcodes (symbology_code, raw_value, normalized_value, status, entity_type, entity_id,
    namespace, source, activated_at, issued_by, metadata)
  VALUES ('CODE128', v_number, warehouse.packship__n(v_number), 'ACTIVE', 'PACKAGE', v_pkg, 'TCDS',
    'GENERATED', clock_timestamp(), a.user_id, '{"authority":"packship_v0.2"}');
  UPDATE warehouse.packing_tasks SET status = 'MEASURING', packing_profile_code = pr.profile_code
   WHERE packing_task_id = t.packing_task_id;

  v_result := warehouse.packship__result(true, 'OK', t.packing_task_id, a, jsonb_build_object('packageId', v_pkg));
  RETURN warehouse.packship__idem_store('SELECT_PACKAGE', p_idempotency_key, v_hash, a, t.packing_task_id, v_result,
    p_request_id, p_correlation_id);
END $$;

DROP FUNCTION IF EXISTS warehouse.packship__eligible_profiles(uuid);
DROP FUNCTION IF EXISTS warehouse.packship__packaging_basis(uuid);
