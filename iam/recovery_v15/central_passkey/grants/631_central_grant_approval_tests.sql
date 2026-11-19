-- 631: tests for 630. Run in the SAME transaction after 630 (626, 628 installed), then ROLLBACK. Synthetic users,
-- passkeys through the real 626 enrollment functions, approvals through the real 630 ceremony.
CREATE TEMP TABLE _r (n serial, test text, pass boolean, detail text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.t(p_test text, p_pass boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO _r (test, pass, detail) VALUES (p_test, coalesce(p_pass, false), p_detail) $$;
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'NO_ERROR'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql AS $$ SELECT sha256(convert_to(p, 'UTF8')) $$;
CREATE TEMP TABLE _c (k text PRIMARY KEY, v text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.u(p_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v::uuid FROM _c WHERE k = p_k $$;
DO $$ BEGIN
 EXECUTE format('GRANT tcds_identity_central_verifier, tcds_identity_central_admin TO %I WITH INHERIT TRUE', current_user);
END $$;

-- the 20 EOC modules, VIEW, enterprise-wide (the pilot set), deliberately in a scrambled order
CREATE FUNCTION pg_temp.view_all() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_agg(jsonb_build_object('scopeIds', '[]'::jsonb, 'operation', 'VIEW', 'scopeKind', 'ENTERPRISE', 'moduleId', m) ORDER BY md5(m))
   FROM unnest(ARRAY['executive','capital','acquisition','market','retail','pqp','purchasing','warehouse','shipping','returns','identity',
                     'hardware','governance','forensic','ai','administration','decisions','agents','knowledge','scenarios']) m $$;

CREATE FUNCTION pg_temp.enroll(p_user uuid, p_admin uuid, p_cid text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE b record; c record; f record; rp text := 'login-stg.tcdsolutionsgroup.com';
BEGIN
 PERFORM warehouse_identity.central_issue_invite_v1(p_user, p_admin, pg_temp.h('tok' || p_cid), rp, 60, 'test', gen_random_uuid());
 SELECT * INTO b FROM warehouse_identity.central_enrollment_begin_v1(pg_temp.h('tok' || p_cid), rp, 'https://' || rp, pg_temp.h('ch' || p_cid), gen_random_uuid(), gen_random_uuid());
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(b.auth_challenge_id, pg_temp.h('ch' || p_cid), pg_temp.h('cl' || p_cid), 'CENTRAL_PASSKEY_ENROLLMENT', rp, NULL, NULL, NULL);
 SELECT * INTO f FROM warehouse_identity.central_finalize_enrollment_v1(b.auth_challenge_id, pg_temp.h('cl' || p_cid), c.claim_generation, p_cid, '\x01'::bytea, -7,
   ARRAY['internal'], NULL, 'multiDevice', true, true, 'test', 'https://' || rp, rp, true, repeat('a', 64), repeat('b', 64), repeat('c', 64), 't', '1', 'c631', gen_random_uuid(), gen_random_uuid());
 IF f.outcome <> 'SUCCEEDED' THEN RAISE EXCEPTION 'enroll failed: %', f.outcome; END IF;
 RETURN f.central_passkey_id;
END $$;

-- one grant approval ceremony for a request, signed with the passkey p_cid at sign counter p_observed
CREATE FUNCTION pg_temp.approve(p_request uuid, p_cid text, p_observed bigint DEFAULT 0)
RETURNS TABLE (outcome text, approver_user_id uuid, evidence_id uuid, approvals integer, complete boolean, approvals_detail jsonb) LANGUAGE plpgsql AS $$
DECLARE ch uuid; c record; m record; rp text := 'login-stg.tcdsolutionsgroup.com'; k text := gen_random_uuid()::text;
BEGIN
 ch := warehouse_identity.central_grant_approval_begin_v1(p_request, rp, 'https://' || rp, pg_temp.h('gp' || k), gen_random_uuid(), gen_random_uuid());
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('gp' || k), pg_temp.h('gcl' || k), 'EOC_GRANT_APPROVAL', rp, NULL, NULL, NULL);
 SELECT * INTO m FROM warehouse_identity.central_passkey_material_v1(p_cid, rp);
 RETURN QUERY SELECT * FROM warehouse_identity.central_finalize_grant_approval_v1(ch, pg_temp.h('gcl' || k), c.claim_generation, m.central_passkey_id,
   m.row_version, m.sign_count, p_observed, 'https://' || rp, rp, true, repeat('a', 64), repeat('b', 64), repeat('d', 64), true, true,
   't', '1', 'c631', gen_random_uuid(), gen_random_uuid());
END $$;

-- G01-G02 structure before any assignment
DO $$
DECLARE fin text := 'warehouse_identity.central_finalize_grant_approval_v1(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid)';
BEGIN
 PERFORM pg_temp.t('G01 approver capability exists, active, assigned to nobody; separate from the binding approver permission',
   (SELECT active AND permissions = ARRAY['enterprise:eoc:module_grant:approve'] FROM warehouse_identity.roles WHERE role_code = 'EOC_MODULE_GRANT_APPROVER')
   AND NOT EXISTS (SELECT 1 FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.roles rol USING (role_id) WHERE rol.role_code = 'EOC_MODULE_GRANT_APPROVER'));
 PERFORM pg_temp.t('G02 privileges: verifier info/begin/finalize/record only, admin request/cancel only, internals for nobody',
   has_function_privilege('tcds_identity_central_verifier', fin, 'EXECUTE')
   AND has_function_privilege('tcds_identity_central_verifier', 'warehouse_identity.central_record_grants_v1(uuid,uuid[],uuid[])', 'EXECUTE')
   AND NOT has_function_privilege('tcds_identity_central_verifier', 'warehouse_identity.central_request_grants_v1(uuid,jsonb,integer,text,uuid,integer)', 'EXECUTE')
   AND has_function_privilege('tcds_identity_central_admin', 'warehouse_identity.central_request_grants_v1(uuid,jsonb,integer,text,uuid,integer)', 'EXECUTE')
   AND NOT has_function_privilege('tcds_identity_central_admin', fin, 'EXECUTE')
   AND NOT has_function_privilege('tcds_identity_central_verifier', 'warehouse_identity.central_normalize_grant_items_v1(jsonb)', 'EXECUTE')
   AND NOT has_function_privilege('tcds_identity_central_admin', 'warehouse_identity.central_is_grant_approver_v1(uuid)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'warehouse_identity.central_grant_request_info_v1(uuid)', 'EXECUTE')
   AND NOT has_function_privilege('service_role', fin, 'EXECUTE'));
END $$;

-- fixtures: target (bound), unbound person, requester, approvers A/B/C (grant role), binding-only approver, facility-scoped
DO $$
DECLARE tgt uuid; nb uuid; adm uuid; a uuid; b uuid; c uuid; bo uuid; fs uuid; role uuid; brole uuid; fac uuid;
BEGIN
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c631.target', 'C631 Target Leader', 'ACTIVE') RETURNING user_id INTO tgt;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c631.unbound', 'C631 Unbound', 'ACTIVE') RETURNING user_id INTO nb;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c631.admin', 'C631 Identity Admin', 'ACTIVE') RETURNING user_id INTO adm;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c631.appr.a', 'C631 Approver A', 'ACTIVE') RETURNING user_id INTO a;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c631.appr.b', 'C631 Approver B', 'ACTIVE') RETURNING user_id INTO b;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c631.appr.c', 'C631 Approver C', 'ACTIVE') RETURNING user_id INTO c;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c631.bindonly', 'C631 Binding-only Approver', 'ACTIVE') RETURNING user_id INTO bo;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c631.facility', 'C631 Facility Approver', 'ACTIVE') RETURNING user_id INTO fs;
 SELECT role_id INTO role FROM warehouse_identity.roles WHERE role_code = 'EOC_MODULE_GRANT_APPROVER';
 SELECT role_id INTO brole FROM warehouse_identity.roles WHERE role_code = 'EOC_IDENTITY_BINDING_APPROVER';
 INSERT INTO warehouse_identity.user_role_assignments (user_id, role_id) VALUES (a, role), (b, role), (c, role), (adm, role), (bo, brole);
 SELECT facility_id INTO fac FROM warehouse.facilities LIMIT 1;
 IF fac IS NOT NULL THEN INSERT INTO warehouse_identity.user_role_assignments (user_id, role_id, facility_id) VALUES (fs, role, fac); END IF;
 INSERT INTO warehouse_identity.eoc_federated_subject_bindings_v12 (issuer, subject_hash, user_id, binding_status, evidence_reference,
   approved_by, secondary_approved_by, verified_at)
 VALUES ('https://login-stg.tcdsolutionsgroup.com', encode(pg_temp.h('c631-subject'), 'hex'), tgt, 'VERIFIED', 'C631_TEST', a, b, clock_timestamp());
 INSERT INTO _c VALUES ('tgt', tgt), ('nb', nb), ('adm', adm), ('a', a), ('b', b), ('c', c), ('bo', bo), ('fs', fs), ('fac', coalesce(fac::text, ''));
 PERFORM pg_temp.enroll(tgt, adm, 'C631TargetCredential01');
 PERFORM pg_temp.enroll(a, adm, 'C631ApproverACredential');
 PERFORM pg_temp.enroll(b, adm, 'C631ApproverBCredential');
 PERFORM pg_temp.enroll(c, adm, 'C631ApproverCCredential');
 PERFORM pg_temp.enroll(bo, adm, 'C631BindOnlyCredential1');
 PERFORM pg_temp.enroll(fs, adm, 'C631FacilityCredential1');
 PERFORM pg_temp.enroll(adm, a, 'C631AdminCredential0001');
END $$;

-- G03-G10 requests: vocabulary, normalization, binding precondition, replacement, info
DO $$
DECLARE tgt uuid := pg_temp.u('tgt'); adm uuid := pg_temp.u('adm'); e text; rq uuid; rq_old uuid; info record; n jsonb;
BEGIN
 e := pg_temp.err(format('SELECT warehouse_identity.central_request_grants_v1(%L, %L, 90, %L, %L, 72)', tgt,
   '[{"moduleId":"payroll","operation":"VIEW","scopeKind":"ENTERPRISE","scopeIds":[]}]', 'x pilot', adm));
 PERFORM pg_temp.t('G03 unknown module refused', e = 'CENTRAL_GRANT_ITEMS_INVALID', e);
 e := pg_temp.err(format('SELECT warehouse_identity.central_request_grants_v1(%L, %L, 90, %L, %L, 72)', tgt,
   '[{"moduleId":"executive","operation":"VIEW","scopeKind":"ENTERPRISE","scopeIds":["x"]}]', 'x pilot', adm));
 PERFORM pg_temp.t('G04 ENTERPRISE scope with ids refused (and FACILITY without ids)', e = 'CENTRAL_GRANT_ITEMS_INVALID'
   AND pg_temp.err(format('SELECT warehouse_identity.central_request_grants_v1(%L, %L, 90, %L, %L, 72)', tgt,
       '[{"moduleId":"executive","operation":"VIEW","scopeKind":"FACILITY","scopeIds":[]}]', 'x pilot', adm)) = 'CENTRAL_GRANT_ITEMS_INVALID', e);
 e := pg_temp.err(format('SELECT warehouse_identity.central_request_grants_v1(%L, %L, 90, %L, %L, 72)', tgt,
   '[{"moduleId":"executive","operation":"VIEW","scopeKind":"ENTERPRISE","scopeIds":[],"admin":true}]', 'x pilot', adm));
 PERFORM pg_temp.t('G05 unexpected item key refused; duplicate item refused', e = 'CENTRAL_GRANT_ITEMS_INVALID'
   AND pg_temp.err(format('SELECT warehouse_identity.central_request_grants_v1(%L, %L, 90, %L, %L, 72)', tgt,
       '[{"moduleId":"ai","operation":"VIEW","scopeKind":"ENTERPRISE","scopeIds":[]},{"scopeIds":[],"scopeKind":"ENTERPRISE","operation":"VIEW","moduleId":"ai"}]',
       'x pilot', adm)) = 'CENTRAL_GRANT_ITEMS_DUPLICATED', e);
 e := pg_temp.err(format('SELECT warehouse_identity.central_request_grants_v1(%L, %L, 90, %L, %L, 72)', pg_temp.u('nb'), pg_temp.view_all(), 'x pilot', adm));
 PERFORM pg_temp.t('G06 a person without a VERIFIED EOC binding cannot be granted', e = 'CENTRAL_GRANT_TARGET_NOT_BOUND', e);
 e := pg_temp.err(format('SELECT warehouse_identity.central_request_grants_v1(%L, %L, 400, %L, %L, 72)', tgt, pg_temp.view_all(), 'x pilot', adm));
 PERFORM pg_temp.t('G07 validity over 366 days refused (the EOC writer limit); self-request refused', e = 'CENTRAL_GRANT_REQUEST_INVALID'
   AND pg_temp.err(format('SELECT warehouse_identity.central_request_grants_v1(%L, %L, 90, %L, %L, 72)', tgt, pg_temp.view_all(), 'x pilot', tgt)) = 'CENTRAL_GRANT_REQUEST_INVALID', e);
 rq_old := warehouse_identity.central_request_grants_v1(tgt, pg_temp.view_all(), 90, 'EOC pilot: CTO module view', adm, 72);
 rq := warehouse_identity.central_request_grants_v1(tgt, pg_temp.view_all(), 90, 'EOC pilot: CTO module view (renewed)', adm, 72);
 PERFORM pg_temp.t('G08 a new request for the same person replaces the open one',
   (SELECT status FROM warehouse_identity.central_grant_requests WHERE central_grant_request_id = rq_old) = 'CANCELLED');
 SELECT items INTO n FROM warehouse_identity.central_grant_requests WHERE central_grant_request_id = rq;
 PERFORM pg_temp.t('G09 items stored in one canonical order; the same set gives the same fingerprint',
   jsonb_array_length(n) = 20 AND n->0->>'moduleId' = 'acquisition' AND n->19->>'moduleId' = 'warehouse'
   AND (SELECT set_sha256 FROM warehouse_identity.central_grant_requests WHERE central_grant_request_id = rq)
     = (SELECT set_sha256 FROM warehouse_identity.central_grant_requests WHERE central_grant_request_id = rq_old), n->0->>'moduleId');
 SELECT * INTO info FROM warehouse_identity.central_grant_request_info_v1(rq);
 PERFORM pg_temp.t('G10 info: OPEN, person, 20 items, 90 days, 0 live approvals, no approval window yet',
   info.status = 'OPEN' AND info.target_display_name = 'C631 Target Leader' AND jsonb_array_length(info.items) = 20 AND info.valid_days = 90
   AND info.approvals = 0 AND info.first_approval_expires_at IS NULL, info.status);
 INSERT INTO _c VALUES ('rq', rq);
END $$;

-- G11-G22 the approval ceremony
DO $$
DECLARE rq uuid := pg_temp.u('rq'); a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b'); r record; info record; e text; d jsonb;
BEGIN
 SELECT * INTO r FROM pg_temp.approve(rq, 'C631TargetCredential01');
 PERFORM pg_temp.t('G11 the person being granted cannot approve', r.outcome = 'APPROVER_IS_THE_TARGET', r.outcome);
 SELECT * INTO r FROM pg_temp.approve(rq, 'C631AdminCredential0001');
 PERFORM pg_temp.t('G12 the requester cannot approve (even with the role)', r.outcome = 'APPROVER_IS_THE_REQUESTER', r.outcome);
 SELECT * INTO r FROM pg_temp.approve(rq, 'C631BindOnlyCredential1');
 PERFORM pg_temp.t('G13 a binding approver is not a grant approver', r.outcome = 'APPROVER_NOT_AUTHORIZED', r.outcome);
 IF pg_temp.u('fac') IS NOT NULL THEN
   SELECT * INTO r FROM pg_temp.approve(rq, 'C631FacilityCredential1');
   PERFORM pg_temp.t('G14 grant approver for one facility only: refused (must be company-wide)', r.outcome = 'APPROVER_NOT_AUTHORIZED', r.outcome);
 END IF;

 SELECT * INTO r FROM pg_temp.approve(rq, 'C631ApproverACredential');
 PERFORM pg_temp.t('G15 first approval: recorded, live 5 minutes, evidence names this request and its fingerprint; not complete',
   r.outcome = 'SUCCEEDED' AND r.approver_user_id = a AND r.approvals = 1 AND NOT r.complete AND r.approvals_detail IS NULL
   AND (SELECT expires_at = verified_at + interval '5 minutes' AND consumed_at IS NULL FROM warehouse_identity.central_grant_approvals WHERE web_authn_evidence_id = r.evidence_id)
   AND (SELECT details->>'purpose' = 'EOC_GRANT_APPROVAL' AND details->>'grantRequestId' = rq::text AND user_verified
          AND details->>'setSha256' = (SELECT set_sha256 FROM warehouse_identity.central_grant_requests WHERE central_grant_request_id = rq)
          FROM warehouse_identity.webauthn_verification_evidence WHERE webauthn_verification_evidence_id = r.evidence_id), r.outcome);
 SELECT * INTO info FROM warehouse_identity.central_grant_request_info_v1(rq);
 PERFORM pg_temp.t('G16 info: 1 live approval and when it runs out', info.approvals = 1
   AND info.first_approval_expires_at BETWEEN clock_timestamp() + interval '4 minutes' AND clock_timestamp() + interval '5 minutes', info.approvals::text);
 SELECT * INTO r FROM pg_temp.approve(rq, 'C631ApproverACredential');
 PERFORM pg_temp.t('G17 the same approver cannot approve twice while the approval is live', r.outcome = 'APPROVER_ALREADY_APPROVED', r.outcome);

 -- the 5-minute window passes (simulated by moving A's approval back in time)
 UPDATE warehouse_identity.central_grant_approvals SET verified_at = now() - interval '6 minutes', expires_at = now() - interval '2 minutes'
  WHERE grant_request_id = rq AND approver_user_id = a;
 SELECT * INTO info FROM warehouse_identity.central_grant_request_info_v1(rq);
 PERFORM pg_temp.t('G18 after 5 minutes the approval no longer counts (info shows 0 live)', info.approvals = 0 AND info.first_approval_expires_at IS NULL, info.approvals::text);
 SELECT * INTO r FROM pg_temp.approve(rq, 'C631ApproverBCredential');
 PERFORM pg_temp.t('G19 an expired approval does not combine with a new one', r.outcome = 'SUCCEEDED' AND r.approvals = 1 AND NOT r.complete, r.outcome);
 SELECT * INTO r FROM pg_temp.approve(rq, 'C631ApproverACredential');
 d := r.approvals_detail;
 PERFORM pg_temp.t('G20 the approver whose approval expired may approve again; with B live the set is complete (both, oldest first)',
   r.outcome = 'SUCCEEDED' AND r.approvals = 2 AND r.complete AND jsonb_array_length(d) = 2
   AND (d->0->>'approverUserId')::uuid = b AND (d->1->>'approverUserId')::uuid = a
   AND (SELECT status FROM warehouse_identity.central_grant_requests WHERE central_grant_request_id = rq) = 'OPEN', r.outcome);
 INSERT INTO _c VALUES ('ap1', d->0->>'approvalId'), ('ap2', d->1->>'approvalId');
 SELECT * INTO r FROM pg_temp.approve(rq, 'C631ApproverCCredential');
 PERFORM pg_temp.t('G21 a third approver is refused once two are live', r.outcome = 'CENTRAL_GRANT_ALREADY_APPROVED', r.outcome);
END $$;

-- G22-G26 recording, cancel, counter
DO $$
DECLARE rq uuid := pg_temp.u('rq'); ap uuid[] := ARRAY[pg_temp.u('ap1'), pg_temp.u('ap2')]; ids uuid[]; e text; info record; r record;
  tgt uuid := pg_temp.u('tgt'); adm uuid := pg_temp.u('adm'); rq2 uuid; rq3 uuid;
BEGIN
 SELECT array_agg(gen_random_uuid()) INTO ids FROM generate_series(1, 20);
 e := pg_temp.err(format('SELECT warehouse_identity.central_record_grants_v1(%L, %L, %L)', rq, ap, ids[1:19]));
 PERFORM pg_temp.t('G22 record refuses a grant list that does not match the set (19 of 20)', e = 'CENTRAL_GRANT_RECORD_INVALID', e);
 e := pg_temp.err(format('SELECT warehouse_identity.central_record_grants_v1(%L, %L, %L)', rq, ARRAY[ap[1], ap[1]], ids));
 PERFORM pg_temp.t('G23 record refuses one approver counted twice', e = 'CENTRAL_GRANT_RECORD_INVALID', e);
 INSERT INTO _c VALUES ('rec', warehouse_identity.central_record_grants_v1(rq, ap, ids)::text);
 PERFORM pg_temp.t('G24 record: request GRANTED with the 20 EOC grant ids, both approvals consumed; info says GRANTED 2',
   (SELECT v FROM _c WHERE k = 'rec') = 'true'
   AND (SELECT status = 'GRANTED' AND eoc_grant_ids = ids FROM warehouse_identity.central_grant_requests WHERE central_grant_request_id = rq)
   AND NOT EXISTS (SELECT 1 FROM warehouse_identity.central_grant_approvals WHERE central_grant_approval_id = ANY (ap) AND consumed_at IS NULL)
   AND (SELECT status = 'GRANTED' AND approvals = 2 FROM warehouse_identity.central_grant_request_info_v1(rq)));
 e := pg_temp.err(format('SELECT warehouse_identity.central_grant_approval_begin_v1(%L, %L, %L, %L, gen_random_uuid(), gen_random_uuid())',
        rq, 'login-stg.tcdsolutionsgroup.com', 'https://login-stg.tcdsolutionsgroup.com', pg_temp.h('x')));
 PERFORM pg_temp.t('G25 a granted request takes no more approvals; recording twice refused', e = 'CENTRAL_GRANT_REQUEST_NOT_OPEN'
   AND pg_temp.err(format('SELECT warehouse_identity.central_record_grants_v1(%L, %L, %L)', rq, ap, ids)) = 'CENTRAL_GRANT_REQUEST_NOT_OPEN', e);
 rq2 := warehouse_identity.central_request_grants_v1(tgt, '[{"moduleId":"executive","operation":"VIEW","scopeKind":"ENTERPRISE","scopeIds":[]}]', 30, 'counter test', adm, 24);
 PERFORM pg_temp.t('G26 cancel: OPEN -> CANCELLED, then no ceremony can start', warehouse_identity.central_cancel_grant_request_v1(rq2)
   AND pg_temp.err(format('SELECT warehouse_identity.central_grant_approval_begin_v1(%L, %L, %L, %L, gen_random_uuid(), gen_random_uuid())',
        rq2, 'login-stg.tcdsolutionsgroup.com', 'https://login-stg.tcdsolutionsgroup.com', pg_temp.h('y'))) = 'CENTRAL_GRANT_REQUEST_NOT_OPEN');
 rq3 := warehouse_identity.central_request_grants_v1(tgt, '[{"moduleId":"executive","operation":"VIEW","scopeKind":"ENTERPRISE","scopeIds":[]}]', 30, 'counter test 2', adm, 24);
 SELECT * INTO r FROM pg_temp.approve(rq3, 'C631ApproverCCredential', 7);
 SELECT * INTO r FROM pg_temp.approve(rq3, 'C631ApproverCCredential', 4);
 PERFORM pg_temp.t('G27 a refused duplicate does not touch the passkey (no counter check, still ACTIVE)', r.outcome = 'APPROVER_ALREADY_APPROVED'
   AND (SELECT security_state FROM warehouse_identity.central_passkey_material_v1('C631ApproverCCredential', 'login-stg.tcdsolutionsgroup.com')) = 'ACTIVE', r.outcome);
 UPDATE warehouse_identity.central_grant_approvals SET verified_at = now() - interval '6 minutes', expires_at = now() - interval '2 minutes'
  WHERE grant_request_id = rq3;
 SELECT * INTO r FROM pg_temp.approve(rq3, 'C631ApproverCCredential', 4);
 PERFORM pg_temp.t('G28 counter regression on an otherwise valid approval suspends the passkey', r.outcome = 'COUNTER_REGRESSION'
   AND (SELECT security_state FROM warehouse_identity.central_passkey_material_v1('C631ApproverCCredential', 'login-stg.tcdsolutionsgroup.com')) = 'SUSPENDED', r.outcome);
END $$;

DO $$ BEGIN
 EXECUTE format('REVOKE tcds_identity_central_verifier, tcds_identity_central_admin FROM %I', current_user);
END $$;
SELECT format('%s %s%s', CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END, test, CASE WHEN pass OR detail IS NULL THEN '' ELSE '  [' || detail || ']' END) FROM _r ORDER BY n;
SELECT format('SUMMARY 630: %s passed, %s failed, %s total', count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass), count(*)) FROM _r;
