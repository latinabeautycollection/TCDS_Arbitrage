-- =====================================================================================================================
-- 914  Pack/Ship V0.2.2: eligible packaging. The dev team (2026-11-17) asked for the eligible
-- warehouse.packaging_profiles records to be served to the PWA through an approved backend interface, with
-- eligibility enforced on the server.
--
-- Eligibility rule PACKSHIP_PACKAGING_ELIGIBILITY_V1 (one place: warehouse.packship__eligible_profiles):
--   1. the profile is active and in date (effective_at <= now < expires_at), as select_package already required;
--   2. only the highest in-date version of each profile_code is offered;
--   3. weight: if the profile has maximum_weight_oz, the task's known item weight must not exceed it. Known weight =
--      sum over the task's items (REMOVED/CANCELLED excluded) of coalesce(items.actual_weight_oz,
--      product_profiles.expected_weight_oz) x expected_quantity. Items with no weight do not count, so a box is
--      refused only when it is known to be too light;
--   4. category: if the profile has item_category_key, every item must have a product-profile category_key equal
--      to it (case-insensitive). An item with no category makes a category-limited box ineligible (fail closed).
--   Not used: minimum_length/width/height_in (meaning not defined: interior size or minimum item size).
--
-- New:     warehouse.packship__packaging_basis(task)       internal, no grants
--          warehouse.packship__eligible_profiles(task)     internal, no grants
--          warehouse.packship_list_packaging_options_v2(session, task)  -> tcds_packship_api
-- Changed: warehouse.packship_select_package_v2 (same signature, owner and grants): an active profile that is not
--          eligible for the task is refused with PACKSHIP_PACKAGING_NOT_ELIGIBLE; the package metadata records the
--          rule and the basis. Every other line is the V0.2 function unchanged.
-- No table changes.
-- =====================================================================================================================

-- Guard: select_package must still be exactly the V0.2 function this was built on.
DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc
       WHERE oid = 'warehouse.packship_select_package_v2(uuid, uuid, bigint, uuid, text, text, uuid, uuid)'::regprocedure)
     <> 'ee44a0d78a4a74fde4b3e70c32779f7d' THEN
    RAISE EXCEPTION 'packship_select_package_v2 is not the V0.2 version this migration was built on - stopping';
  END IF;
END $$;

-- What the rule looks at, for one task. Also returned to the PWA as "basis" and stored on the package.
CREATE OR REPLACE FUNCTION warehouse.packship__packaging_basis(p_task_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
           'itemCount', count(*),
           'knownWeightOz', coalesce(sum(coalesce(wi.actual_weight_oz, pp.expected_weight_oz) * i.expected_quantity), 0),
           'itemsWithoutWeight', count(*) FILTER (WHERE coalesce(wi.actual_weight_oz, pp.expected_weight_oz) IS NULL),
           'categories', coalesce(to_jsonb(array_agg(DISTINCT lower(pp.category_key::text))
                                            FILTER (WHERE pp.category_key IS NOT NULL)), '[]'::jsonb),
           'itemsWithoutCategory', count(*) FILTER (WHERE pp.category_key IS NULL))
    FROM warehouse.packing_tasks t
    JOIN warehouse.packing_task_items i ON i.packing_task_id = t.packing_task_id
         AND i.status NOT IN ('REMOVED', 'CANCELLED')
    LEFT JOIN warehouse.items wi ON wi.item_id = i.item_id AND wi.facility_id = t.facility_id
    LEFT JOIN warehouse.product_profiles pp ON pp.product_profile_id = wi.product_profile_id
   WHERE t.packing_task_id = p_task_id
$$;

-- The single implementation of PACKSHIP_PACKAGING_ELIGIBILITY_V1. Used by the list and by select_package.
CREATE OR REPLACE FUNCTION warehouse.packship__eligible_profiles(p_task_id uuid)
RETURNS SETOF warehouse.packaging_profiles LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH b AS (SELECT warehouse.packship__packaging_basis(p_task_id) AS v),
  cur AS (
    SELECT DISTINCT ON (pr.profile_code) pr.*
      FROM warehouse.packaging_profiles pr
     WHERE pr.active AND pr.effective_at <= clock_timestamp()
       AND (pr.expires_at IS NULL OR pr.expires_at > clock_timestamp())
     ORDER BY pr.profile_code, pr.version DESC)
  SELECT cur.* FROM cur, b
   WHERE (cur.maximum_weight_oz IS NULL OR (b.v->>'knownWeightOz')::numeric <= cur.maximum_weight_oz)
     AND (cur.item_category_key IS NULL
          OR ((b.v->>'itemCount')::int > 0 AND (b.v->>'itemsWithoutCategory')::int = 0
              AND b.v->'categories' = jsonb_build_array(lower(cur.item_category_key))))
   ORDER BY cur.profile_code
$$;

-- Read: the boxes the PWA may offer for this task. Same access as packship_get_task_v2 (valid packer session, task in
-- the session's facility). "selectable" says whether select_package would accept a choice right now.
CREATE OR REPLACE FUNCTION warehouse.packship_list_packaging_options_v2(p_auth_session_id uuid, p_packing_task_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a warehouse.packship_actor_t; t warehouse.packing_tasks%ROWTYPE; c warehouse.packing_task_claims%ROWTYPE;
  v_options jsonb; v_held boolean; v_now timestamptz := clock_timestamp();
BEGIN
  a := warehouse.packship__actor(p_auth_session_id);
  SELECT * INTO t FROM warehouse.packing_tasks WHERE packing_task_id = p_packing_task_id;
  IF NOT FOUND THEN PERFORM warehouse.packship__fail('PACKSHIP_TASK_NOT_FOUND'); END IF;
  IF t.facility_id <> a.facility_id THEN PERFORM warehouse.packship__fail('PACKSHIP_FACILITY_MISMATCH'); END IF;
  SELECT * INTO c FROM warehouse.packing_task_claims WHERE packing_task_id = t.packing_task_id AND released_at IS NULL;
  v_held := coalesce(c.employee_id = a.employee_id AND c.device_id = a.device_id AND c.expires_at > v_now, false);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'profileId', e.packaging_profile_id, 'profileCode', e.profile_code, 'profileName', e.profile_name,
           'version', e.version, 'packagingTypeCode', e.packaging_type_code, 'itemCategoryKey', e.item_category_key,
           'maximumWeightOz', e.maximum_weight_oz, 'minimumLengthIn', e.minimum_length_in,
           'minimumWidthIn', e.minimum_width_in, 'minimumHeightIn', e.minimum_height_in) ORDER BY e.profile_code), '[]'::jsonb)
    INTO v_options FROM warehouse.packship__eligible_profiles(t.packing_task_id) e;
  RETURN jsonb_build_object(
    'ok', true, 'code', 'OK', 'packingTaskId', t.packing_task_id, 'taskStatus', t.status, 'taskRowVersion', t.row_version,
    'selectable', t.status = 'PACKING' AND v_held
                  AND (warehouse.packship__current_package(t.packing_task_id)).package_id IS NULL
                  AND (t.assigned_station_id IS NULL OR t.assigned_station_id = a.device_station_id),
    'eligibilityRule', 'PACKSHIP_PACKAGING_ELIGIBILITY_V1',
    'basis', warehouse.packship__packaging_basis(t.packing_task_id),
    'options', v_options);
END $$;

-- 6. Select packaging (V0.2 + eligibility). Marked lines (V0.2.2) are the only changes.
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
  -- V0.2.2: the same rule the PWA list uses
  IF NOT EXISTS (SELECT 1 FROM warehouse.packship__eligible_profiles(t.packing_task_id) e
                  WHERE e.packaging_profile_id = pr.packaging_profile_id) THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PACKAGING_NOT_ELIGIBLE',
      jsonb_build_object('profileCode', pr.profile_code, 'rule', 'PACKSHIP_PACKAGING_ELIGIBILITY_V1'));
  END IF;

  v_number := 'TCDS-PKG-' || upper(substr(replace(v_pkg::text, '-', ''), 1, 12));
  INSERT INTO warehouse.packages (package_id, fulfillment_order_id, package_number, packing_station_id, status,
    packaging_type_code, metadata)
  VALUES (v_pkg, t.fulfillment_order_id, v_number, a.device_station_id, 'OPEN', pr.packaging_type_code,
    jsonb_build_object('packagingProfileId', pr.packaging_profile_id, 'profileCode', pr.profile_code,
                       'profileVersion', pr.version, 'reason', left(p_reason, 500), 'authority', 'packship_v0.2',
                       -- V0.2.2: what the eligibility decision was based on
                       'eligibilityRule', 'PACKSHIP_PACKAGING_ELIGIBILITY_V1',
                       'eligibilityBasis', warehouse.packship__packaging_basis(t.packing_task_id)));
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

-- Privileges: helpers owner-only; the list is for the API role only (as every other V0.2 entry point)
REVOKE ALL ON FUNCTION warehouse.packship__packaging_basis(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION warehouse.packship__eligible_profiles(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION warehouse.packship_list_packaging_options_v2(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION warehouse.packship_list_packaging_options_v2(uuid, uuid) TO tcds_packship_api;
