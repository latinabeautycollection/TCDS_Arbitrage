-- =====================================================================================================================
-- 915  Pack/Ship V0.2.2 eligible-packaging tests. Run in the SAME transaction AFTER 914, the V0.2 suite (911) and the
-- V0.2.1 suite (913), which leave: task2 (order2, item3 with a product profile) CLAIMED by session B; session A
-- revoked; session S valid but without the packing permission. Then ROLLBACK. Prints its own lines (T73+).
-- Production may hold other packaging profiles (e.g. PSTEST-BOX-S), so list checks only look at PSV022-* codes.
-- =====================================================================================================================
DELETE FROM _r;

CREATE FUNCTION pg_temp.codes(p jsonb) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(o->>'profileCode' ORDER BY o->>'profileCode'), '{}')
    FROM jsonb_array_elements(p->'options') o WHERE o->>'profileCode' LIKE 'PSV022-%' $$;

DO $$
DECLARE r jsonb; e text; t2 uuid := pg_temp.u('task2'); sb uuid := pg_temp.u('sess_b'); ss uuid := pg_temp.u('sess_s');
  pp uuid; rv bigint; prv bigint; k text; pkg uuid; p_light uuid; p_toys uuid; p_phone uuid; p_exp uuid; p_v1 uuid;
  n_pkg bigint;
BEGIN
  INSERT INTO warehouse.packaging_profiles (profile_code, profile_name, version, packaging_type_code, maximum_weight_oz)
  VALUES ('PSV022-HEAVY', 'PSV022 heavy box', 1, 'BOX', 64), ('PSV022-LIGHT', 'PSV022 light mailer', 1, 'MAILER', 8);
  SELECT packaging_profile_id INTO p_light FROM warehouse.packaging_profiles WHERE profile_code = 'PSV022-LIGHT';
  INSERT INTO warehouse.packaging_profiles (profile_code, profile_name, version, packaging_type_code, item_category_key)
  VALUES ('PSV022-PHONE', 'PSV022 phone box', 1, 'BOX', 'Phones') RETURNING packaging_profile_id INTO p_phone;
  INSERT INTO warehouse.packaging_profiles (profile_code, profile_name, version, packaging_type_code, item_category_key)
  VALUES ('PSV022-TOYS', 'PSV022 toy box', 1, 'BOX', 'toys') RETURNING packaging_profile_id INTO p_toys;
  INSERT INTO warehouse.packaging_profiles (profile_code, profile_name, version, packaging_type_code, expires_at)
  VALUES ('PSV022-EXPIRED', 'PSV022 expired', 1, 'BOX', clock_timestamp() - interval '1 day') RETURNING packaging_profile_id INTO p_exp;
  INSERT INTO warehouse.packaging_profiles (profile_code, profile_name, version, packaging_type_code, active)
  VALUES ('PSV022-INACTIVE', 'PSV022 inactive', 1, 'BOX', false);
  INSERT INTO warehouse.packaging_profiles (profile_code, profile_name, version, packaging_type_code, effective_at)
  VALUES ('PSV022-FUTURE', 'PSV022 future', 1, 'BOX', clock_timestamp() + interval '1 day');
  INSERT INTO warehouse.packaging_profiles (profile_code, profile_name, version, packaging_type_code)
  VALUES ('PSV022-VER', 'PSV022 versioned v1', 1, 'BOX') RETURNING packaging_profile_id INTO p_v1;
  INSERT INTO warehouse.packaging_profiles (profile_code, profile_name, version, packaging_type_code)
  VALUES ('PSV022-VER', 'PSV022 versioned v2', 2, 'BOX');
  SELECT wi.product_profile_id INTO pp FROM warehouse.items wi WHERE wi.item_id = pg_temp.u('item3');

  -- T73-T77: task2 is CLAIMED; item3 has no weight and no category
  r := warehouse.packship_list_packaging_options_v2(sb, t2);
  PERFORM pg_temp.t('T73 list shape: ok, rule V1, basis, options; not selectable while CLAIMED',
    r->>'ok' = 'true' AND r->>'eligibilityRule' = 'PACKSHIP_PACKAGING_ELIGIBILITY_V1' AND r->>'taskStatus' = 'CLAIMED'
    AND (r->>'taskRowVersion')::bigint = pg_temp.rv(t2) AND r ? 'basis' AND jsonb_typeof(r->'options') = 'array'
    AND r->>'selectable' = 'false', r::text);
  PERFORM pg_temp.t('T74 unknown weight: both weight-limited boxes offered (refuse only when known too heavy)',
    pg_temp.codes(r) @> ARRAY['PSV022-HEAVY','PSV022-LIGHT'] AND (r->'basis'->>'itemsWithoutWeight')::int = 1
    AND (r->'basis'->>'knownWeightOz')::numeric = 0, array_to_string(pg_temp.codes(r), ','));
  PERFORM pg_temp.t('T75 unknown category: category-limited boxes not offered (fail closed)',
    NOT pg_temp.codes(r) && ARRAY['PSV022-PHONE','PSV022-TOYS'], array_to_string(pg_temp.codes(r), ','));
  PERFORM pg_temp.t('T76 expired, inactive and future profiles not offered',
    NOT pg_temp.codes(r) && ARRAY['PSV022-EXPIRED','PSV022-INACTIVE','PSV022-FUTURE'], array_to_string(pg_temp.codes(r), ','));
  PERFORM pg_temp.t('T77 two in-date versions: only the highest offered',
    (SELECT count(*) FROM jsonb_array_elements(r->'options') o WHERE o->>'profileCode' = 'PSV022-VER') = 1
    AND (SELECT (o->>'version')::int FROM jsonb_array_elements(r->'options') o WHERE o->>'profileCode' = 'PSV022-VER') = 2);
  PERFORM pg_temp.t('T78 option fields: real profileId plus code, name, type, limits',
    (SELECT o ?& ARRAY['profileId','profileCode','profileName','version','packagingTypeCode','itemCategoryKey',
                       'maximumWeightOz','minimumLengthIn','minimumWidthIn','minimumHeightIn']
            AND (o->>'profileId')::uuid = p_light
       FROM jsonb_array_elements(r->'options') o WHERE o->>'profileCode' = 'PSV022-LIGHT'));

  -- T79-T81: weight and category from the item / product profile
  UPDATE warehouse.items SET actual_weight_oz = 12 WHERE item_id = pg_temp.u('item3');
  r := warehouse.packship_list_packaging_options_v2(sb, t2);
  PERFORM pg_temp.t('T79 item weight 12 oz: 8 oz mailer refused, 64 oz box offered',
    pg_temp.codes(r) @> ARRAY['PSV022-HEAVY'] AND NOT pg_temp.codes(r) && ARRAY['PSV022-LIGHT']
    AND (r->'basis'->>'knownWeightOz')::numeric = 12, r->>'basis');
  UPDATE warehouse.items SET actual_weight_oz = NULL WHERE item_id = pg_temp.u('item3');
  UPDATE warehouse.product_profiles SET expected_weight_oz = 10 WHERE product_profile_id = pp;
  r := warehouse.packship_list_packaging_options_v2(sb, t2);
  PERFORM pg_temp.t('T80 no item weight: product expected weight (10 oz) used',
    (r->'basis'->>'knownWeightOz')::numeric = 10 AND NOT pg_temp.codes(r) && ARRAY['PSV022-LIGHT'], r->>'basis');
  UPDATE warehouse.product_profiles SET category_key = 'PHONES' WHERE product_profile_id = pp;
  r := warehouse.packship_list_packaging_options_v2(sb, t2);
  PERFORM pg_temp.t('T81 category PHONES: phone box offered (case-insensitive), toy box not',
    pg_temp.codes(r) @> ARRAY['PSV022-PHONE'] AND NOT pg_temp.codes(r) && ARRAY['PSV022-TOYS'],
    array_to_string(pg_temp.codes(r), ','));

  -- T82: access
  e := pg_temp.err(format('SELECT warehouse.packship_list_packaging_options_v2(%L, %L)', ss, t2));
  PERFORM pg_temp.t('T82 session without the packing permission: ACTOR_NOT_ALLOWED', e = 'PACKSHIP_ACTOR_NOT_ALLOWED', e);
  e := pg_temp.err(format('SELECT warehouse.packship_list_packaging_options_v2(%L, %L)', sb, gen_random_uuid()));
  PERFORM pg_temp.t('T83 unknown task: TASK_NOT_FOUND', e = 'PACKSHIP_TASK_NOT_FOUND', e);

  -- T84-T85: to PACKING (source, then the one item)
  r := warehouse.packship_verify_source_v2(sb, t2, pg_temp.rv(t2), 'PSV02-SRC-01', '{"source":"HID"}', pg_temp.k(), NULL, NULL);
  r := warehouse.packship_verify_item_v2(sb, t2, pg_temp.rv(t2), 'PSV02-ITEM-0003', '{"source":"HID"}', pg_temp.k(), NULL, NULL);
  r := warehouse.packship_list_packaging_options_v2(sb, t2);
  PERFORM pg_temp.t('T84 PACKING, claim held, no package: selectable',
    r->>'taskStatus' = 'PACKING' AND r->>'selectable' = 'true', r->>'taskStatus');

  -- T85-T88: select_package enforces the same rule; refusals change nothing
  rv := pg_temp.rv(t2);
  SELECT count(*) INTO n_pkg FROM warehouse.packing_task_packages WHERE packing_task_id = t2;
  e := pg_temp.err(format('SELECT warehouse.packship_select_package_v2(%L, %L, %s, %L, NULL, %L, NULL, NULL)', sb, t2, rv, p_light, pg_temp.k()));
  PERFORM pg_temp.t('T85 too-light mailer: PACKAGING_NOT_ELIGIBLE, task and packages unchanged',
    e = 'PACKSHIP_PACKAGING_NOT_ELIGIBLE' AND pg_temp.rv(t2) = rv
    AND (SELECT count(*) FROM warehouse.packing_task_packages WHERE packing_task_id = t2) = n_pkg, e);
  e := pg_temp.err(format('SELECT warehouse.packship_select_package_v2(%L, %L, %s, %L, NULL, %L, NULL, NULL)', sb, t2, rv, p_toys, pg_temp.k()));
  PERFORM pg_temp.t('T86 wrong category box: PACKAGING_NOT_ELIGIBLE', e = 'PACKSHIP_PACKAGING_NOT_ELIGIBLE', e);
  e := pg_temp.err(format('SELECT warehouse.packship_select_package_v2(%L, %L, %s, %L, NULL, %L, NULL, NULL)', sb, t2, rv, p_v1, pg_temp.k()));
  PERFORM pg_temp.t('T87 superseded version 1: PACKAGING_NOT_ELIGIBLE', e = 'PACKSHIP_PACKAGING_NOT_ELIGIBLE', e);
  e := pg_temp.err(format('SELECT warehouse.packship_select_package_v2(%L, %L, %s, %L, NULL, %L, NULL, NULL)', sb, t2, rv, p_exp, pg_temp.k()));
  PERFORM pg_temp.t('T88 expired profile: still PRECONDITION_FAILED (V0.2 behaviour kept)', e = 'PACKSHIP_PRECONDITION_FAILED', e);

  -- T89-T91: an eligible box is accepted, recorded, replayable
  k := pg_temp.k();
  r := warehouse.packship_select_package_v2(sb, t2, rv, p_phone, 'phone box', k, NULL, NULL);
  pkg := (r->>'packageId')::uuid;
  PERFORM pg_temp.t('T89 eligible phone box: OK, MEASURING; package records rule and basis',
    r->>'ok' = 'true' AND r->'task'->>'status' = 'MEASURING'
    AND (SELECT metadata->>'eligibilityRule' = 'PACKSHIP_PACKAGING_ELIGIBILITY_V1'
                AND (metadata->'eligibilityBasis'->>'knownWeightOz')::numeric = 10
                AND metadata->>'profileCode' = 'PSV022-PHONE'
           FROM warehouse.packages WHERE package_id = pkg), r->>'code');
  r := warehouse.packship_select_package_v2(sb, t2, rv, p_phone, 'phone box', k, NULL, NULL);
  PERFORM pg_temp.t('T90 same key again: replayed, same package', r->>'replayed' = 'true' AND (r->>'packageId')::uuid = pkg);
  r := warehouse.packship_list_packaging_options_v2(sb, t2);
  PERFORM pg_temp.t('T91 after selection: not selectable (status MEASURING, package exists)',
    r->>'selectable' = 'false' AND r->>'taskStatus' = 'MEASURING');
END $$;

-- T92-T94 privileges
DO $$
DECLARE fn_list regprocedure := 'warehouse.packship_list_packaging_options_v2(uuid, uuid)'::regprocedure;
BEGIN
  PERFORM pg_temp.t('T92 list: API role only (not anon, authenticated, service_role, PUBLIC); owner postgres',
    has_function_privilege('tcds_packship_api', fn_list, 'EXECUTE')
    AND NOT has_function_privilege('anon', fn_list, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', fn_list, 'EXECUTE')
    AND NOT has_function_privilege('service_role', fn_list, 'EXECUTE')
    AND (SELECT pg_get_userbyid(proowner) = 'postgres' AND NOT EXISTS (
           SELECT 1 FROM aclexplode(coalesce(proacl, acldefault('f', proowner))) x WHERE x.grantee = 0)
           FROM pg_proc WHERE oid = fn_list));
  PERFORM pg_temp.t('T93 helpers: owner only, API role cannot call them',
    (SELECT bool_and(pg_get_userbyid(proowner) = 'postgres' AND NOT EXISTS (
           SELECT 1 FROM aclexplode(coalesce(proacl, acldefault('f', proowner))) x WHERE x.grantee <> proowner))
       FROM pg_proc WHERE oid IN ('warehouse.packship__packaging_basis(uuid)'::regprocedure,
                                  'warehouse.packship__eligible_profiles(uuid)'::regprocedure))
    AND NOT has_function_privilege('tcds_packship_api', 'warehouse.packship__eligible_profiles(uuid)', 'EXECUTE'));
  PERFORM pg_temp.t('T94 select_package grants unchanged: API role yes, anon no; API role has no packaging_profiles access',
    has_function_privilege('tcds_packship_api', 'warehouse.packship_select_package_v2(uuid, uuid, bigint, uuid, text, text, uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'warehouse.packship_select_package_v2(uuid, uuid, bigint, uuid, text, text, uuid, uuid)', 'EXECUTE')
    AND NOT has_table_privilege('tcds_packship_api', 'warehouse.packaging_profiles', 'SELECT'));
END $$;

-- T95 as the API role: the list works with no table access
DO $$
DECLARE r jsonb; e text; v_sess uuid := pg_temp.u('sess_b'); v_task uuid := pg_temp.u('task2');
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE tcds_packship_api';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.t('T95 call as tcds_packship_api (SKIPPED: this login cannot SET ROLE to it)', true);
    RETURN;
  END;
  r := warehouse.packship_list_packaging_options_v2(v_sess, v_task);
  e := pg_temp.err('SELECT count(*) FROM warehouse.packaging_profiles');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.t('T95 as tcds_packship_api: list returns options, direct SELECT denied',
    r->>'ok' = 'true' AND jsonb_array_length(r->'options') > 0 AND e LIKE 'permission denied%', e);
END $$;

SELECT format('%s %s%s', CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END, test, CASE WHEN pass OR detail IS NULL THEN '' ELSE '  [' || detail || ']' END)
  FROM _r ORDER BY n;
SELECT format('SUMMARY V0.2.2: %s passed, %s failed, %s total', count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass), count(*)) FROM _r;
