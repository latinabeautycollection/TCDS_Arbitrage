-- 629: tests for 628. Run in the SAME transaction after 628 (626, 623, 624 installed), then ROLLBACK. Synthetic users,
-- passkeys created through the real 626 enrollment functions, approvals through the real 628 ceremony.
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

-- a passkey for a user through the real enrollment path (synthetic attestation hashes)
CREATE FUNCTION pg_temp.enroll(p_user uuid, p_admin uuid, p_cid text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE b record; c record; f record; rp text := 'login-stg.tcdsolutionsgroup.com';
BEGIN
 PERFORM warehouse_identity.central_issue_invite_v1(p_user, p_admin, pg_temp.h('tok' || p_cid), rp, 60, 'test', gen_random_uuid());
 SELECT * INTO b FROM warehouse_identity.central_enrollment_begin_v1(pg_temp.h('tok' || p_cid), rp, 'https://' || rp, pg_temp.h('ch' || p_cid), gen_random_uuid(), gen_random_uuid());
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(b.auth_challenge_id, pg_temp.h('ch' || p_cid), pg_temp.h('cl' || p_cid), 'CENTRAL_PASSKEY_ENROLLMENT', rp, NULL, NULL, NULL);
 SELECT * INTO f FROM warehouse_identity.central_finalize_enrollment_v1(b.auth_challenge_id, pg_temp.h('cl' || p_cid), c.claim_generation, p_cid, '\x01'::bytea, -7,
   ARRAY['internal'], NULL, 'multiDevice', true, true, 'test', 'https://' || rp, rp, true, repeat('a', 64), repeat('b', 64), repeat('c', 64), 't', '1', 'c629', gen_random_uuid(), gen_random_uuid());
 IF f.outcome <> 'SUCCEEDED' THEN RAISE EXCEPTION 'enroll failed: %', f.outcome; END IF;
 RETURN f.central_passkey_id;
END $$;

-- one approval ceremony for a binding request, signed with the passkey p_cid
CREATE FUNCTION pg_temp.approve(p_request uuid, p_cid text, p_observed bigint DEFAULT 0)
RETURNS TABLE (outcome text, approver_user_id uuid, evidence_id uuid, approvals integer, binding_id uuid, bound boolean) LANGUAGE plpgsql AS $$
DECLARE ch uuid; c record; m record; rp text := 'login-stg.tcdsolutionsgroup.com'; k text := gen_random_uuid()::text;
BEGIN
 ch := warehouse_identity.central_approval_begin_v1(p_request, rp, 'https://' || rp, pg_temp.h('ap' || k), gen_random_uuid(), gen_random_uuid());
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('ap' || k), pg_temp.h('acl' || k), 'EOC_BINDING_APPROVAL', rp, NULL, NULL, NULL);
 SELECT * INTO m FROM warehouse_identity.central_passkey_material_v1(p_cid, rp);
 RETURN QUERY SELECT * FROM warehouse_identity.central_finalize_approval_v1(ch, pg_temp.h('acl' || k), c.claim_generation, m.central_passkey_id,
   m.row_version, m.sign_count, p_observed, 'https://' || rp, rp, true, repeat('a', 64), repeat('b', 64), repeat('d', 64), true, true,
   't', '1', 'c629', gen_random_uuid(), gen_random_uuid());
END $$;

-- fixtures: target, requester (identity admin), approvers A and B (global role), outsider, facility-scoped approver
DO $$
DECLARE tgt uuid; adm uuid; a uuid; b uuid; o uuid; fs uuid; role uuid; fac uuid;
BEGIN
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c629.target', 'C629 Target Leader', 'ACTIVE') RETURNING user_id INTO tgt;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c629.admin', 'C629 Identity Admin', 'ACTIVE') RETURNING user_id INTO adm;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c629.appr.a', 'C629 Approver A', 'ACTIVE') RETURNING user_id INTO a;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c629.appr.b', 'C629 Approver B', 'ACTIVE') RETURNING user_id INTO b;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c629.outsider', 'C629 Outsider', 'ACTIVE') RETURNING user_id INTO o;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c629.facility', 'C629 Facility Approver', 'ACTIVE') RETURNING user_id INTO fs;
 SELECT role_id INTO role FROM warehouse_identity.roles WHERE role_code = 'EOC_IDENTITY_BINDING_APPROVER';
 INSERT INTO warehouse_identity.user_role_assignments (user_id, role_id) VALUES (a, role), (b, role), (adm, role);
 SELECT facility_id INTO fac FROM warehouse.facilities LIMIT 1;
 IF fac IS NOT NULL THEN INSERT INTO warehouse_identity.user_role_assignments (user_id, role_id, facility_id) VALUES (fs, role, fac); END IF;
 INSERT INTO _c VALUES ('tgt', tgt), ('adm', adm), ('a', a), ('b', b), ('o', o), ('fs', fs), ('fac', coalesce(fac::text, ''));
 PERFORM pg_temp.enroll(tgt, adm, 'C629TargetCredential01');
 PERFORM pg_temp.enroll(a, adm, 'C629ApproverACredential');
 PERFORM pg_temp.enroll(b, adm, 'C629ApproverBCredential');
 PERFORM pg_temp.enroll(o, adm, 'C629OutsiderCredential1');
 PERFORM pg_temp.enroll(fs, adm, 'C629FacilityCredential1');
 PERFORM pg_temp.enroll(adm, a, 'C629AdminCredential0001');
END $$;

-- A01-A03 structure and privileges
DO $$
DECLARE w regprocedure := 'warehouse_identity.eoc_create_binding_v13(uuid,uuid,text,text,uuid,uuid,uuid)'::regprocedure;
BEGIN
 PERFORM pg_temp.t('A01 the 624 writer is the 628 version, same owner, still executable only by tcds_eoc_binding_admin',
   (SELECT md5(prosrc) <> '131c35ea8937bbbe39c075d835704d0a' AND prosrc LIKE '%EOC_BINDING_APPROVAL%' AND pg_get_userbyid(proowner) = 'tcds_identity_function_owner'
      FROM pg_proc WHERE oid = w)
   AND has_function_privilege('tcds_eoc_binding_admin', w, 'EXECUTE') AND NOT has_function_privilege('tcds_identity_central_verifier', w, 'EXECUTE')
   AND NOT has_function_privilege('anon', w, 'EXECUTE') AND NOT has_function_privilege('public', w, 'EXECUTE'));
 PERFORM pg_temp.t('A02 approvals: a Warehouse-method approval still needs its session (CHECK), central needs none',
   (SELECT count(*) FROM pg_constraint WHERE conname = 'eoc_binding_approvals_v13_method_session_check') = 1
   AND (SELECT NOT attnotnull FROM pg_attribute WHERE attrelid = 'warehouse_identity.eoc_binding_approvals_v13'::regclass AND attname = 'auth_session_id'));
 PERFORM pg_temp.t('A03 new functions: verifier has begin/info/finalize only, admin has request/cancel only',
   has_function_privilege('tcds_identity_central_verifier', 'warehouse_identity.central_finalize_approval_v1(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid)', 'EXECUTE')
   AND NOT has_function_privilege('tcds_identity_central_verifier', 'warehouse_identity.central_request_binding_v1(uuid,text,text,text,uuid,integer)', 'EXECUTE')
   AND has_function_privilege('tcds_identity_central_admin', 'warehouse_identity.central_request_binding_v1(uuid,text,text,text,uuid,integer)', 'EXECUTE')
   AND NOT has_function_privilege('tcds_identity_central_admin', 'warehouse_identity.central_approval_begin_v1(uuid,text,text,bytea,uuid,uuid)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'warehouse_identity.central_binding_request_info_v1(uuid)', 'EXECUTE'));
END $$;

-- A04-A17 requests and approvals
DO $$
DECLARE iss text := 'https://login-stg.tcdsolutionsgroup.com'; sh text := encode(pg_temp.h('opaque-subject-of-target'), 'hex');
  tgt uuid := pg_temp.u('tgt'); adm uuid := pg_temp.u('adm'); a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b');
  e text; rq uuid; rq_old uuid; r record; info record; bid uuid;
BEGIN
 e := pg_temp.err(format('SELECT warehouse_identity.central_request_binding_v1(%L, %L, %L, %L, %L, 24)', tgt, iss, sh, 'EOC pilot: CTO', tgt));
 PERFORM pg_temp.t('A04 the person cannot request their own binding', e = 'CENTRAL_BINDING_REQUEST_INVALID', e);
 e := pg_temp.err(format('SELECT warehouse_identity.central_request_binding_v1(%L, %L, %L, %L, %L, 24)', pg_temp.u('fs'), 'http://x', sh, 'EOC pilot', adm));
 PERFORM pg_temp.t('A05 non-https issuer refused', e = 'CENTRAL_BINDING_REQUEST_INVALID', e);
 rq_old := warehouse_identity.central_request_binding_v1(tgt, iss, sh, 'EOC pilot: CTO', adm, 24);
 rq := warehouse_identity.central_request_binding_v1(tgt, iss, sh, 'EOC pilot: CTO (renewed)', adm, 24);
 PERFORM pg_temp.t('A06 a new request for the same person replaces the open one',
   (SELECT status FROM warehouse_identity.central_binding_requests WHERE central_binding_request_id = rq_old) = 'CANCELLED');
 SELECT * INTO info FROM warehouse_identity.central_binding_request_info_v1(rq);
 PERFORM pg_temp.t('A07 request info: person, purpose, OPEN, 0 approvals (no hash shown)',
   info.target_display_name = 'C629 Target Leader' AND info.status = 'OPEN' AND info.approvals = 0 AND info.purpose = 'EOC pilot: CTO (renewed)', info.status);

 SELECT * INTO r FROM pg_temp.approve(rq, 'C629TargetCredential01');
 PERFORM pg_temp.t('A08 the person being bound cannot approve', r.outcome = 'APPROVER_IS_THE_TARGET', r.outcome);
 SELECT * INTO r FROM pg_temp.approve(rq, 'C629AdminCredential0001');
 PERFORM pg_temp.t('A09 the requester cannot approve (even with the role)', r.outcome = 'APPROVER_IS_THE_REQUESTER', r.outcome);
 SELECT * INTO r FROM pg_temp.approve(rq, 'C629OutsiderCredential1');
 PERFORM pg_temp.t('A10 no approver role: refused', r.outcome = 'APPROVER_NOT_AUTHORIZED', r.outcome);
 IF pg_temp.u('fac') IS NOT NULL THEN
   SELECT * INTO r FROM pg_temp.approve(rq, 'C629FacilityCredential1');
   PERFORM pg_temp.t('A11 approver role assigned for one facility only: refused (must be company-wide)', r.outcome = 'APPROVER_NOT_AUTHORIZED', r.outcome);
 END IF;

 SELECT * INTO r FROM pg_temp.approve(rq, 'C629ApproverACredential');
 PERFORM pg_temp.t('A12 first approval: recorded as CENTRAL_PASSKEY, no session, evidence names this request; not bound yet',
   r.outcome = 'SUCCEEDED' AND r.approver_user_id = a AND r.approvals = 1 AND NOT r.bound
   AND (SELECT approval_method = 'CENTRAL_PASSKEY' AND auth_session_id IS NULL AND consumed_at IS NULL FROM warehouse_identity.eoc_binding_approvals_v13
          WHERE web_authn_evidence_id = r.evidence_id)
   AND (SELECT details->>'purpose' = 'EOC_BINDING_APPROVAL' AND details->>'bindingRequestId' = rq::text AND user_verified
          FROM warehouse_identity.webauthn_verification_evidence WHERE webauthn_verification_evidence_id = r.evidence_id), r.outcome);
 SELECT * INTO r FROM pg_temp.approve(rq, 'C629ApproverACredential');
 PERFORM pg_temp.t('A13 the same approver cannot approve twice', r.outcome = 'APPROVER_ALREADY_APPROVED', r.outcome);
 PERFORM pg_temp.t('A14 no binding exists after one approval',
   NOT EXISTS (SELECT 1 FROM warehouse_identity.eoc_federated_subject_bindings_v12 WHERE issuer = iss AND user_id = tgt));

 SELECT * INTO r FROM pg_temp.approve(rq, 'C629ApproverBCredential');
 bid := r.binding_id;
 PERFORM pg_temp.t('A15 second approver: the 623 binding is written (VERIFIED, both approvers), request BOUND, approvals consumed',
   r.outcome = 'SUCCEEDED' AND r.bound AND r.approvals = 2
   AND (SELECT binding_status = 'VERIFIED' AND user_id = tgt AND subject_hash = sh AND approved_by = a AND secondary_approved_by = b
          FROM warehouse_identity.eoc_federated_subject_bindings_v12 WHERE binding_id = bid)
   AND (SELECT status = 'BOUND' FROM warehouse_identity.central_binding_requests WHERE central_binding_request_id = rq)
   AND NOT EXISTS (SELECT 1 FROM warehouse_identity.eoc_binding_approvals_v13 WHERE request_id = rq AND consumed_at IS NULL), r.outcome);
 PERFORM pg_temp.t('A16 the 623 resolver now maps the subject to the person',
   warehouse_identity.eoc_resolve_federation_v623(iss, sh, gen_random_uuid()) = tgt);
 e := pg_temp.err(format('SELECT * FROM pg_temp.approve(%L, %L)', rq, 'C629OutsiderCredential1'));
 PERFORM pg_temp.t('A17 a bound request takes no more approvals', e = 'CENTRAL_BINDING_REQUEST_NOT_OPEN', e);
 e := pg_temp.err(format('SELECT warehouse_identity.central_request_binding_v1(%L, %L, %L, %L, %L, 24)', tgt, iss, sh, 'again', adm));
 PERFORM pg_temp.t('A18 no second binding request once bound', e = 'CENTRAL_BINDING_ALREADY_EXISTS', e);
 INSERT INTO _c VALUES ('rq', rq);
END $$;

-- A19-A21 the writer cannot be fed other evidence; cancel; counter regression
-- real evidence from a LOGIN ceremony (purpose EOC_OIDC_LOGIN) for a passkey, through the 626 login functions
CREATE FUNCTION pg_temp.login_evidence(p_cid text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE ch uuid; c record; m record; f record; rp text := 'login-stg.tcdsolutionsgroup.com'; iss text := 'https://login-stg.tcdsolutionsgroup.com';
  iid text := 'c629_' || substr(md5(random()::text), 1, 12); irq uuid := gen_random_uuid(); k text := gen_random_uuid()::text;
BEGIN
 ch := warehouse_identity.central_login_begin_v1(iss, iid, irq, rp, 'https://' || rp, pg_temp.h('lg' || k), gen_random_uuid(), gen_random_uuid(), 120);
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('lg' || k), pg_temp.h('lgc' || k), 'EOC_OIDC_LOGIN', rp, iss, iid, irq);
 SELECT * INTO m FROM warehouse_identity.central_passkey_material_v1(p_cid, rp);
 SELECT * INTO f FROM warehouse_identity.central_finalize_login_v1(ch, pg_temp.h('lgc' || k), c.claim_generation, m.central_passkey_id, m.row_version,
   m.sign_count, 0, 'https://' || rp, rp, true, repeat('a', 64), repeat('b', 64), repeat('d', 64), true, true, 't', '1', 'c629', gen_random_uuid(), gen_random_uuid());
 IF f.outcome <> 'SUCCEEDED' THEN RAISE EXCEPTION 'login evidence failed: %', f.outcome; END IF;
 RETURN f.evidence_id;
END $$;

DO $$
DECLARE iss text := 'https://login-stg.tcdsolutionsgroup.com'; sh2 text := encode(pg_temp.h('opaque-subject-of-outsider'), 'hex');
  sh3 text := encode(pg_temp.h('opaque-subject-of-facility'), 'hex');
  o uuid := pg_temp.u('o'); fs uuid := pg_temp.u('fs'); adm uuid := pg_temp.u('adm'); a uuid := pg_temp.u('a'); b uuid := pg_temp.u('b');
  rq2 uuid; bid2 uuid; ev_a uuid; ev_b uuid; e text; r record; rq3 uuid; rq4 uuid;
BEGIN
 rq2 := warehouse_identity.central_request_binding_v1(o, iss, sh2, 'EOC pilot: forged path', adm, 24);
 SELECT binding_id INTO bid2 FROM warehouse_identity.central_binding_requests WHERE central_binding_request_id = rq2;
 ev_a := pg_temp.login_evidence('C629ApproverACredential');
 ev_b := pg_temp.login_evidence('C629ApproverBCredential');
 -- Approval rows written directly (as the vendor attestation-writer role could), pointing at fresh, user-verified
 -- evidence of the right approvers, but from a LOGIN, not an approval of this request. The 628 writer must refuse.
 INSERT INTO warehouse_identity.eoc_binding_approvals_v13 (evidence_id, request_id, binding_id, approver_user_id, auth_session_id, web_authn_evidence_id,
   target_user_id, oidc_issuer, subject_hash, verified_at, expires_at, verifier_digest, ceremony_id, approval_method)
 VALUES (gen_random_uuid(), rq2, bid2, a, NULL, ev_a, o, iss, sh2, clock_timestamp(), clock_timestamp() + interval '4 minutes', repeat('e', 64), gen_random_uuid(), 'CENTRAL_PASSKEY'),
        (gen_random_uuid(), rq2, bid2, b, NULL, ev_b, o, iss, sh2, clock_timestamp(), clock_timestamp() + interval '4 minutes', repeat('f', 64), gen_random_uuid(), 'CENTRAL_PASSKEY');
 e := pg_temp.err(format('SELECT warehouse_identity.eoc_create_binding_v13(%L, %L, %L, %L, %L, %L, %L)', bid2, o, iss, sh2, rq2, a, b));
 PERFORM pg_temp.t('A19 the writer refuses approvals backed by LOGIN evidence (not made for this request); no binding written',
   e = 'BINDING_APPROVER_REVOKED_OR_UNVERIFIED'
   AND NOT EXISTS (SELECT 1 FROM warehouse_identity.eoc_federated_subject_bindings_v12 WHERE binding_id = bid2), e);
 PERFORM pg_temp.t('A20 cancel: OPEN -> CANCELLED, then no approval ceremony can start',
   warehouse_identity.central_cancel_binding_request_v1(rq2)
   AND pg_temp.err(format('SELECT warehouse_identity.central_approval_begin_v1(%L, %L, %L, %L, gen_random_uuid(), gen_random_uuid())',
        rq2, 'login-stg.tcdsolutionsgroup.com', 'https://login-stg.tcdsolutionsgroup.com', pg_temp.h('x'))) = 'CENTRAL_BINDING_REQUEST_NOT_OPEN');
 -- counter: approver A signs at 5 on one request; that request is cancelled; A then signs at 3 on a new one
 rq3 := warehouse_identity.central_request_binding_v1(fs, iss, sh3, 'EOC pilot: counter', adm, 24);
 SELECT * INTO r FROM pg_temp.approve(rq3, 'C629ApproverACredential', 5);
 PERFORM warehouse_identity.central_cancel_binding_request_v1(rq3);
 rq4 := warehouse_identity.central_request_binding_v1(fs, iss, sh3, 'EOC pilot: counter 2', adm, 24);
 SELECT * INTO r FROM pg_temp.approve(rq4, 'C629ApproverACredential', 3);
 PERFORM pg_temp.t('A21 a counter going back on an approval suspends that passkey', r.outcome = 'COUNTER_REGRESSION'
   AND (SELECT security_state FROM warehouse_identity.central_passkey_material_v1('C629ApproverACredential', 'login-stg.tcdsolutionsgroup.com')) = 'SUSPENDED', r.outcome);
END $$;

DO $$ BEGIN
 EXECUTE format('REVOKE tcds_identity_central_verifier, tcds_identity_central_admin FROM %I', current_user);
END $$;
SELECT format('%s %s%s', CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END, test, CASE WHEN pass OR detail IS NULL THEN '' ELSE '  [' || detail || ']' END) FROM _r ORDER BY n;
SELECT format('SUMMARY 628: %s passed, %s failed, %s total', count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass), count(*)) FROM _r;
