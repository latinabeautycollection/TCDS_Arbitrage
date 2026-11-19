-- 627: tests for 626. Run in the SAME transaction right after 626, then ROLLBACK. Uses synthetic users and hashes
-- (no real credential). The migrator temporarily joins the two new roles inside this transaction only.
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

-- C01-C06 structure and privileges
DO $$
DECLARE fns text[] := ARRAY(SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'warehouse_identity' AND p.proname LIKE 'central\_%');
  verifier_fns text[] := ARRAY['central_claim_workload_nonce_v1','central_enrollment_begin_v1','central_login_begin_v1','central_claim_challenge_v1','central_fail_challenge_v1',
                               'central_passkey_material_v1','central_finalize_enrollment_v1','central_finalize_login_v1'];
BEGIN
 PERFORM pg_temp.t('C01 two NOLOGIN roles', (SELECT count(*) FROM pg_roles WHERE rolname IN ('tcds_identity_central_verifier','tcds_identity_central_admin') AND NOT rolcanlogin) = 2);
 PERFORM pg_temp.t('C02 12 functions: owner function owner, SECURITY DEFINER, search_path pg_catalog',
   (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'warehouse_identity' AND p.proname LIKE 'central\_%'
     AND pg_get_userbyid(p.proowner) = 'tcds_identity_function_owner' AND p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog']) = 12);
 PERFORM pg_temp.t('C03 no function executable by PUBLIC, anon, authenticated, service_role',
   NOT EXISTS (SELECT 1 FROM unnest(fns) fx, unnest(ARRAY['public','anon','authenticated','service_role']) r WHERE has_function_privilege(r, fx, 'EXECUTE')));
 PERFORM pg_temp.t('C04 verifier: exactly the 8 ceremony functions; admin: exactly invite + revoke',
   (SELECT count(*) FROM unnest(fns) fx WHERE has_function_privilege('tcds_identity_central_verifier', fx, 'EXECUTE')) = 8
   AND (SELECT bool_and(has_function_privilege('tcds_identity_central_verifier', (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'warehouse_identity' AND p.proname = v), 'EXECUTE')) FROM unnest(verifier_fns) v)
   AND (SELECT count(*) FROM unnest(fns) fx WHERE has_function_privilege('tcds_identity_central_admin', fx, 'EXECUTE')) = 2
   AND has_function_privilege('tcds_identity_central_admin', 'warehouse_identity.central_issue_invite_v1(uuid,uuid,bytea,text,integer,text,uuid)', 'EXECUTE'));
 PERFORM pg_temp.t('C05 neither role has table access (central or shared)',
   NOT EXISTS (SELECT 1 FROM unnest(ARRAY['tcds_identity_central_verifier','tcds_identity_central_admin']) r,
     unnest(ARRAY['central_passkeys','central_enrollment_invites','central_challenge_context','central_workload_nonces','auth_challenges','webauthn_verification_evidence','users']) t
     WHERE has_table_privilege(r, 'warehouse_identity.' || t, 'SELECT') OR has_table_privilege(r, 'warehouse_identity.' || t, 'INSERT')
        OR has_table_privilege(r, 'warehouse_identity.' || t, 'UPDATE')));
 PERFORM pg_temp.t('C06 central tables: RLS forced, no access for anon/authenticated/service_role',
   (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE oid IN ('warehouse_identity.central_passkeys'::regclass,
     'warehouse_identity.central_enrollment_invites'::regclass, 'warehouse_identity.central_challenge_context'::regclass))
   AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r, unnest(ARRAY['central_passkeys','central_enrollment_invites','central_challenge_context']) t
     WHERE has_table_privilege(r, 'warehouse_identity.' || t, 'SELECT')));
END $$;

-- fixtures: three synthetic users (leader, admin, inactive)
DO $$
DECLARE l uuid; a uuid; x uuid;
BEGIN
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c627_leader', 'C627 Leader', 'ACTIVE') RETURNING user_id INTO l;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c627_admin', 'C627 Admin', 'ACTIVE') RETURNING user_id INTO a;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c627_gone', 'C627 Inactive', 'DISABLED') RETURNING user_id INTO x;
 INSERT INTO _c VALUES ('leader', l), ('admin', a), ('gone', x),
   ('wh_passkeys', (SELECT count(*) FROM warehouse_identity.passkeys)::text);
END $$;

-- C07-C18 enrollment
DO $$
DECLARE l uuid := pg_temp.u('leader'); a uuid := pg_temp.u('admin'); x uuid := pg_temp.u('gone');
  rp text := 'login-stg.tcdsolutionsgroup.com'; o text := 'https://login-stg.tcdsolutionsgroup.com';
  e text; i1 uuid; i2 uuid; b record; c record; f record; g bigint; cid text := 'Q2VudHJhbFBhc3NrZXlUZXN0MDAx';
BEGIN
 e := pg_temp.err(format('SELECT warehouse_identity.central_issue_invite_v1(%L, %L, %L, %L, 60, %L, gen_random_uuid())', l, l, pg_temp.h('t0'), rp, 'self'));
 PERFORM pg_temp.t('C07 a user cannot issue their own invite', e = 'CENTRAL_INVITE_REQUEST_INVALID', e);
 e := pg_temp.err(format('SELECT warehouse_identity.central_issue_invite_v1(%L, %L, %L, %L, 60, %L, gen_random_uuid())', x, a, pg_temp.h('t0'), rp, 'inactive'));
 PERFORM pg_temp.t('C08 no invite for an inactive user', e = 'CENTRAL_INVITE_USER_NOT_ACTIVE', e);
 i1 := warehouse_identity.central_issue_invite_v1(l, a, pg_temp.h('tok1'), rp, 60, 'pilot leader enrollment', gen_random_uuid());
 i2 := warehouse_identity.central_issue_invite_v1(l, a, pg_temp.h('tok2'), rp, 60, 'pilot leader enrollment again', gen_random_uuid());
 e := pg_temp.err(format('SELECT * FROM warehouse_identity.central_enrollment_begin_v1(%L, %L, %L, %L, gen_random_uuid(), gen_random_uuid())', pg_temp.h('tok1'), rp, o, pg_temp.h('ch-x')));
 PERFORM pg_temp.t('C09 a new invite revokes the previous open one (old token refused)', i1 <> i2 AND e = 'CENTRAL_INVITE_INVALID', e);
 e := pg_temp.err(format('SELECT * FROM warehouse_identity.central_enrollment_begin_v1(%L, %L, %L, %L, gen_random_uuid(), gen_random_uuid())', pg_temp.h('tok2'), 'warehouse-app.tcdsolutionsgroup.com', 'https://warehouse-app.tcdsolutionsgroup.com', pg_temp.h('ch-x')));
 PERFORM pg_temp.t('C10a invite for login-stg refused on the Warehouse RP', e = 'CENTRAL_INVITE_INVALID', e);
 e := pg_temp.err(format('SELECT * FROM warehouse_identity.central_enrollment_begin_v1(%L, %L, %L, %L, gen_random_uuid(), gen_random_uuid())', pg_temp.h('tok2'), rp, 'https://evil.example', pg_temp.h('ch-x')));
 PERFORM pg_temp.t('C10b origin must be https://<rp id>', e = 'CENTRAL_ENROLLMENT_REQUEST_INVALID', e);

 SELECT * INTO b FROM warehouse_identity.central_enrollment_begin_v1(pg_temp.h('tok2'), rp, o, pg_temp.h('ch-e1'), gen_random_uuid(), gen_random_uuid());
 PERFORM pg_temp.t('C11 begin: challenge for the invited user, 32-byte handle, nothing to exclude; stored with no device on the central RP',
   b.user_id = l AND b.username = 'c627_leader' AND octet_length(b.user_handle) = 32 AND b.exclude_credential_ids = ARRAY[]::text[]
   AND (SELECT device_id IS NULL AND user_id = l AND ceremony_type = 'PASSKEY_REGISTRATION' AND expected_rp_id = rp AND expected_origin = o
          FROM warehouse_identity.auth_challenges WHERE auth_challenge_id = b.auth_challenge_id));
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(b.auth_challenge_id, pg_temp.h('ch-e1'), pg_temp.h('claim1'), 'EOC_OIDC_LOGIN', rp, NULL, NULL, NULL);
 PERFORM pg_temp.t('C12a an enrollment challenge cannot be claimed as a login', c.outcome = 'PURPOSE_OR_RP_MISMATCH', c.outcome);
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(b.auth_challenge_id, pg_temp.h('wrong'), pg_temp.h('claim1'), 'CENTRAL_PASSKEY_ENROLLMENT', rp, NULL, NULL, NULL);
 PERFORM pg_temp.t('C12b wrong challenge: refused and counted',
   c.outcome = 'CHALLENGE_MISMATCH' AND (SELECT attempts FROM warehouse_identity.auth_challenges WHERE auth_challenge_id = b.auth_challenge_id) = 1, c.outcome);
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(b.auth_challenge_id, pg_temp.h('ch-e1'), pg_temp.h('claim1'), 'CENTRAL_PASSKEY_ENROLLMENT', rp, NULL, NULL, NULL);
 g := c.claim_generation;
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(b.auth_challenge_id, pg_temp.h('ch-e1'), pg_temp.h('claim2'), 'CENTRAL_PASSKEY_ENROLLMENT', rp, NULL, NULL, NULL);
 PERFORM pg_temp.t('C13 one claim at a time', g IS NOT NULL AND c.outcome = 'CHALLENGE_ALREADY_CLAIMED', c.outcome);
 SELECT * INTO f FROM warehouse_identity.central_finalize_enrollment_v1(b.auth_challenge_id, pg_temp.h('claim2'), g, cid, '\x01'::bytea, -7, ARRAY['internal'],
   NULL, 'multiDevice', true, true, 'Laptop', o, rp, true, repeat('a', 64), repeat('b', 64), repeat('c', 64), 'test', '1', 'c627', gen_random_uuid(), gen_random_uuid());
 PERFORM pg_temp.t('C14 finalize without the held claim: CLAIM_NOT_HELD', f.outcome = 'CLAIM_NOT_HELD', f.outcome);
 SELECT * INTO f FROM warehouse_identity.central_finalize_enrollment_v1(b.auth_challenge_id, pg_temp.h('claim1'), g, cid, '\x01'::bytea, -7, ARRAY['internal'],
   NULL, 'multiDevice', true, true, 'Laptop', o, rp, false, repeat('a', 64), repeat('b', 64), repeat('c', 64), 'test', '1', 'c627', gen_random_uuid(), gen_random_uuid());
 PERFORM pg_temp.t('C15 no user verification: refused, challenge consumed as FAILED, no passkey',
   f.outcome = 'ENROLLMENT_EVIDENCE_INVALID' AND (SELECT result = 'FAILED' AND consumed_at IS NOT NULL FROM warehouse_identity.auth_challenges WHERE auth_challenge_id = b.auth_challenge_id)
   AND NOT EXISTS (SELECT 1 FROM warehouse_identity.central_passkey_material_v1(cid, rp)), f.outcome);

 SELECT * INTO b FROM warehouse_identity.central_enrollment_begin_v1(pg_temp.h('tok2'), rp, o, pg_temp.h('ch-e2'), gen_random_uuid(), gen_random_uuid());
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(b.auth_challenge_id, pg_temp.h('ch-e2'), pg_temp.h('claim3'), 'CENTRAL_PASSKEY_ENROLLMENT', rp, NULL, NULL, NULL);
 SELECT * INTO f FROM warehouse_identity.central_finalize_enrollment_v1(b.auth_challenge_id, pg_temp.h('claim3'), c.claim_generation, cid, '\x01'::bytea, -7, ARRAY['internal'],
   NULL, 'multiDevice', true, true, 'Laptop', o, rp, true, repeat('a', 64), repeat('b', 64), repeat('c', 64), 'test', '1', 'c627', gen_random_uuid(), gen_random_uuid());
 INSERT INTO _c VALUES ('passkey', f.central_passkey_id);
 PERFORM pg_temp.t('C16 enrollment: passkey for the user, evidence in the shared table (no Warehouse passkey id), challenge SUCCEEDED, invite consumed',
   f.outcome = 'SUCCEEDED' AND f.user_id = l
   AND (SELECT ceremony_type = 'PASSKEY_REGISTRATION' AND passkey_id IS NULL AND user_id = l AND verified_rp_id = rp AND user_verified
               AND details->>'centralPasskeyId' = f.central_passkey_id::text
          FROM warehouse_identity.webauthn_verification_evidence WHERE webauthn_verification_evidence_id = f.evidence_id)
   AND (SELECT result = 'SUCCEEDED' AND verification_evidence_id = f.evidence_id FROM warehouse_identity.auth_challenges WHERE auth_challenge_id = b.auth_challenge_id)
   AND (SELECT security_state = 'ACTIVE' AND user_active AND user_handle = b.user_handle FROM warehouse_identity.central_passkey_material_v1(cid, rp)), f.outcome);
 e := pg_temp.err(format('SELECT * FROM warehouse_identity.central_enrollment_begin_v1(%L, %L, %L, %L, gen_random_uuid(), gen_random_uuid())', pg_temp.h('tok2'), rp, o, pg_temp.h('ch-e3')));
 PERFORM pg_temp.t('C17 a consumed invite cannot be used again', e = 'CENTRAL_INVITE_INVALID', e);
 PERFORM warehouse_identity.central_issue_invite_v1(l, a, pg_temp.h('tok3'), rp, 60, 'second laptop', gen_random_uuid());
 SELECT * INTO b FROM warehouse_identity.central_enrollment_begin_v1(pg_temp.h('tok3'), rp, o, pg_temp.h('ch-e4'), gen_random_uuid(), gen_random_uuid());
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(b.auth_challenge_id, pg_temp.h('ch-e4'), pg_temp.h('claim4'), 'CENTRAL_PASSKEY_ENROLLMENT', rp, NULL, NULL, NULL);
 SELECT * INTO f FROM warehouse_identity.central_finalize_enrollment_v1(b.auth_challenge_id, pg_temp.h('claim4'), c.claim_generation, cid, '\x01'::bytea, -7, ARRAY['internal'],
   NULL, 'multiDevice', true, true, 'Laptop', o, rp, true, repeat('a', 64), repeat('b', 64), repeat('c', 64), 'test', '1', 'c627', gen_random_uuid(), gen_random_uuid());
 PERFORM pg_temp.t('C18 second laptop: same user handle, existing credential excluded, the same credential cannot register twice',
   b.exclude_credential_ids = ARRAY[cid] AND b.user_handle = (SELECT user_handle FROM warehouse_identity.central_passkey_material_v1(cid, rp))
   AND f.outcome = 'CREDENTIAL_ALREADY_REGISTERED', f.outcome);
END $$;

-- C19-C31 login
DO $$
DECLARE rp text := 'login-stg.tcdsolutionsgroup.com'; o text := 'https://login-stg.tcdsolutionsgroup.com'; iss text := 'https://login-stg.tcdsolutionsgroup.com';
  pk uuid := pg_temp.u('passkey'); l uuid := pg_temp.u('leader'); a uuid := pg_temp.u('admin'); cid text := 'Q2VudHJhbFBhc3NrZXlUZXN0MDAx';
  e text; ch uuid; c record; f record; m record; i int; iid text; irq uuid;
BEGIN
 e := pg_temp.err(format('SELECT warehouse_identity.central_login_begin_v1(%L, %L, gen_random_uuid(), %L, %L, %L, gen_random_uuid(), gen_random_uuid(), 300)', iss, 'interaction-0001', rp, o, pg_temp.h('l0')));
 PERFORM pg_temp.t('C19a login challenge lifetime over 120 s refused', e = 'CENTRAL_LOGIN_REQUEST_INVALID', e);
 e := pg_temp.err(format('SELECT warehouse_identity.central_login_begin_v1(%L, %L, gen_random_uuid(), %L, %L, %L, gen_random_uuid(), gen_random_uuid(), 120)', 'http://login-stg.tcdsolutionsgroup.com', 'interaction-0001', rp, o, pg_temp.h('l0')));
 PERFORM pg_temp.t('C19b non-https issuer refused', e = 'CENTRAL_LOGIN_REQUEST_INVALID', e);
 iid := 'interaction-0001'; irq := gen_random_uuid(); ch := warehouse_identity.central_login_begin_v1(iss, iid, irq, rp, o, pg_temp.h('l1'), gen_random_uuid(), gen_random_uuid(), 120);
 PERFORM pg_temp.t('C20 login challenge: no user, no device, at most 120 s, issuer-bound context',
   (SELECT user_id IS NULL AND device_id IS NULL AND ceremony_type = 'PASSKEY_AUTHENTICATION' AND expires_at <= created_at + interval '120 seconds'
      FROM warehouse_identity.auth_challenges WHERE auth_challenge_id = ch));
 e := pg_temp.err(format('SELECT warehouse_identity.central_login_begin_v1(%L, %L, gen_random_uuid(), %L, %L, %L, gen_random_uuid(), gen_random_uuid(), 120)', iss, 'interaction-0001', rp, o, pg_temp.h('l1b')));
 PERFORM pg_temp.t('C21 one live challenge per issuer interaction', e = 'CENTRAL_LOGIN_ALREADY_STARTED', e);
 PERFORM pg_temp.t('C22 passkey material only for its own RP',
   EXISTS (SELECT 1 FROM warehouse_identity.central_passkey_material_v1(cid, rp))
   AND NOT EXISTS (SELECT 1 FROM warehouse_identity.central_passkey_material_v1(cid, 'warehouse-app.tcdsolutionsgroup.com')));
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('l1'), pg_temp.h('lc1'), 'CENTRAL_PASSKEY_ENROLLMENT', rp, NULL, NULL, NULL);
 PERFORM pg_temp.t('C23 a login challenge cannot be claimed as an enrollment', c.outcome = 'PURPOSE_OR_RP_MISMATCH', c.outcome);
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('l1'), pg_temp.h('lc1'), 'EOC_OIDC_LOGIN', rp, iss, 'interaction-9999', irq);
 PERFORM pg_temp.t('C23b a login claim for another interaction: ISSUER_BINDING_MISMATCH', c.outcome = 'ISSUER_BINDING_MISMATCH', c.outcome);
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('l1'), pg_temp.h('lc1'), 'EOC_OIDC_LOGIN', rp, iss, iid, gen_random_uuid());
 PERFORM pg_temp.t('C23c a login claim for another issuer request: ISSUER_BINDING_MISMATCH', c.outcome = 'ISSUER_BINDING_MISMATCH', c.outcome);
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('l1'), pg_temp.h('lc1'), 'EOC_OIDC_LOGIN', rp, iss, iid, irq);
 SELECT * INTO m FROM warehouse_identity.central_passkey_material_v1(cid, rp);
 SELECT * INTO f FROM warehouse_identity.central_finalize_login_v1(ch, pg_temp.h('lc1'), c.claim_generation, m.central_passkey_id, m.row_version, m.sign_count, 0,
   o, rp, false, repeat('a', 64), repeat('b', 64), repeat('d', 64), true, true, 'test', '1', 'c627', gen_random_uuid(), gen_random_uuid());
 PERFORM pg_temp.t('C24 login without user verification refused (challenge consumed)', f.outcome = 'USER_VERIFICATION_REQUIRED'
   AND (SELECT result = 'FAILED' FROM warehouse_identity.auth_challenges WHERE auth_challenge_id = ch), f.outcome);

 iid := 'interaction-0002'; irq := '11111111-1111-4111-8111-111111111111'; ch := warehouse_identity.central_login_begin_v1(iss, iid, irq, rp, o, pg_temp.h('l2'), gen_random_uuid(), gen_random_uuid(), 120);
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('l2'), pg_temp.h('lc2'), 'EOC_OIDC_LOGIN', rp, iss, iid, irq);
 SELECT * INTO m FROM warehouse_identity.central_passkey_material_v1(cid, rp);
 SELECT * INTO f FROM warehouse_identity.central_finalize_login_v1(ch, pg_temp.h('lc2'), c.claim_generation, m.central_passkey_id, m.row_version, m.sign_count, 0,
   o, rp, true, repeat('a', 64), repeat('b', 64), repeat('d', 64), true, true, 'test', '1', 'c627', gen_random_uuid(), gen_random_uuid());
 PERFORM pg_temp.t('C25 login (synced passkey, counter 0): user, evidence with issuer + interaction, challenge now owned by the user',
   f.outcome = 'SUCCEEDED' AND f.user_id = l AND f.issuer = iss AND f.interaction_id = 'interaction-0002'
   AND f.issuer_request_id = '11111111-1111-4111-8111-111111111111' AND f.auth_time IS NOT NULL
   AND (SELECT ceremony_type = 'PASSKEY_AUTHENTICATION' AND user_id = l AND passkey_id IS NULL AND details->>'interactionId' = 'interaction-0002'
          FROM warehouse_identity.webauthn_verification_evidence WHERE webauthn_verification_evidence_id = f.evidence_id)
   AND (SELECT user_id = l AND result = 'SUCCEEDED' FROM warehouse_identity.auth_challenges WHERE auth_challenge_id = ch), f.outcome);
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('l2'), pg_temp.h('lc2b'), 'EOC_OIDC_LOGIN', rp, iss, iid, irq);
 SELECT * INTO f FROM warehouse_identity.central_finalize_login_v1(ch, pg_temp.h('lc2'), 1, m.central_passkey_id, m.row_version + 1, 0, 0,
   o, rp, true, repeat('a', 64), repeat('b', 64), repeat('d', 64), true, true, 'test', '1', 'c627', gen_random_uuid(), gen_random_uuid());
 PERFORM pg_temp.t('C26 replay: the used challenge cannot be claimed or finalized again', c.outcome = 'CHALLENGE_CONSUMED' AND f.outcome = 'CLAIM_NOT_HELD', c.outcome || '/' || f.outcome);

 -- counting authenticator: 0 -> 3 accepted, then 2 is a regression and suspends the passkey
 iid := 'interaction-0003'; irq := gen_random_uuid(); ch := warehouse_identity.central_login_begin_v1(iss, iid, irq, rp, o, pg_temp.h('l3'), gen_random_uuid(), gen_random_uuid(), 120);
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('l3'), pg_temp.h('lc3'), 'EOC_OIDC_LOGIN', rp, iss, iid, irq);
 SELECT * INTO m FROM warehouse_identity.central_passkey_material_v1(cid, rp);
 SELECT * INTO f FROM warehouse_identity.central_finalize_login_v1(ch, pg_temp.h('lc3'), c.claim_generation, m.central_passkey_id, m.row_version, m.sign_count + 1, 3,
   o, rp, true, repeat('a', 64), repeat('b', 64), repeat('d', 64), true, true, 'test', '1', 'c627', gen_random_uuid(), gen_random_uuid());
 PERFORM pg_temp.t('C27 stale prior counter / row version: PASSKEY_STATE_CHANGED', f.outcome = 'PASSKEY_STATE_CHANGED', f.outcome);
 iid := 'interaction-0004'; irq := gen_random_uuid(); ch := warehouse_identity.central_login_begin_v1(iss, iid, irq, rp, o, pg_temp.h('l4'), gen_random_uuid(), gen_random_uuid(), 120);
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('l4'), pg_temp.h('lc4'), 'EOC_OIDC_LOGIN', rp, iss, iid, irq);
 SELECT * INTO m FROM warehouse_identity.central_passkey_material_v1(cid, rp);
 SELECT * INTO f FROM warehouse_identity.central_finalize_login_v1(ch, pg_temp.h('lc4'), c.claim_generation, m.central_passkey_id, m.row_version, m.sign_count, 3,
   o, rp, true, repeat('a', 64), repeat('b', 64), repeat('d', 64), true, true, 'test', '1', 'c627', gen_random_uuid(), gen_random_uuid());
 iid := 'interaction-0005'; irq := gen_random_uuid(); ch := warehouse_identity.central_login_begin_v1(iss, iid, irq, rp, o, pg_temp.h('l5'), gen_random_uuid(), gen_random_uuid(), 120);
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('l5'), pg_temp.h('lc5'), 'EOC_OIDC_LOGIN', rp, iss, iid, irq);
 SELECT * INTO m FROM warehouse_identity.central_passkey_material_v1(cid, rp);
 PERFORM pg_temp.t('C28a counter 0 -> 3 accepted', f.outcome = 'SUCCEEDED' AND m.sign_count = 3, f.outcome);
 SELECT * INTO f FROM warehouse_identity.central_finalize_login_v1(ch, pg_temp.h('lc5'), c.claim_generation, m.central_passkey_id, m.row_version, m.sign_count, 2,
   o, rp, true, repeat('a', 64), repeat('b', 64), repeat('d', 64), true, true, 'test', '1', 'c627', gen_random_uuid(), gen_random_uuid());
 PERFORM pg_temp.t('C28b counter going back (3 -> 2): refused and the passkey is suspended', f.outcome = 'COUNTER_REGRESSION'
   AND (SELECT security_state = 'SUSPENDED' FROM warehouse_identity.central_passkey_material_v1(cid, rp)), f.outcome);
 iid := 'interaction-0006'; irq := gen_random_uuid(); ch := warehouse_identity.central_login_begin_v1(iss, iid, irq, rp, o, pg_temp.h('l6'), gen_random_uuid(), gen_random_uuid(), 120);
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('l6'), pg_temp.h('lc6'), 'EOC_OIDC_LOGIN', rp, iss, iid, irq);
 SELECT * INTO m FROM warehouse_identity.central_passkey_material_v1(cid, rp);
 SELECT * INTO f FROM warehouse_identity.central_finalize_login_v1(ch, pg_temp.h('lc6'), c.claim_generation, m.central_passkey_id, m.row_version, m.sign_count, 9,
   o, rp, true, repeat('a', 64), repeat('b', 64), repeat('d', 64), true, true, 'test', '1', 'c627', gen_random_uuid(), gen_random_uuid());
 PERFORM pg_temp.t('C29 a suspended passkey cannot log in', f.outcome = 'CREDENTIAL_OR_USER_NOT_ACTIVE', f.outcome);

 iid := 'interaction-0007'; irq := gen_random_uuid(); ch := warehouse_identity.central_login_begin_v1(iss, iid, irq, rp, o, pg_temp.h('l7'), gen_random_uuid(), gen_random_uuid(), 120);
 FOR i IN 1..5 LOOP SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('guess' || i), pg_temp.h('lc7'), 'EOC_OIDC_LOGIN', rp, iss, iid, irq); END LOOP;
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, pg_temp.h('l7'), pg_temp.h('lc7'), 'EOC_OIDC_LOGIN', rp, iss, iid, irq);
 PERFORM pg_temp.t('C30 five wrong attempts lock the challenge, the right one is then refused', c.outcome = 'CHALLENGE_CONSUMED'
   AND (SELECT locked_at IS NOT NULL AND failure_code = 'TOO_MANY_ATTEMPTS' FROM warehouse_identity.auth_challenges WHERE auth_challenge_id = ch), c.outcome);

 INSERT INTO _c VALUES ('rev1', warehouse_identity.central_revoke_passkey_v1(pk, a, 'pilot test revoke')::text);
 INSERT INTO _c VALUES ('rev2', warehouse_identity.central_revoke_passkey_v1(pk, a, 'pilot test revoke')::text);
 PERFORM pg_temp.t('C31 admin revoke: REVOKED, and a second revoke reports nothing to do',
   (SELECT v FROM _c WHERE k = 'rev1') = 'true' AND (SELECT v FROM _c WHERE k = 'rev2') = 'false'
   AND (SELECT security_state = 'REVOKED' FROM warehouse_identity.central_passkey_material_v1(cid, rp)));
 PERFORM pg_temp.t('C33 workload nonce: first use accepted, replay refused, bad expiry refused',
   warehouse_identity.central_claim_workload_nonce_v1(pg_temp.h('n1'), gen_random_uuid(), gen_random_uuid(), clock_timestamp() + interval '70 seconds')
   AND NOT warehouse_identity.central_claim_workload_nonce_v1(pg_temp.h('n1'), gen_random_uuid(), gen_random_uuid(), clock_timestamp() + interval '70 seconds')
   AND NOT warehouse_identity.central_claim_workload_nonce_v1(pg_temp.h('n2'), gen_random_uuid(), gen_random_uuid(), clock_timestamp() + interval '1 hour'));
 PERFORM pg_temp.t('C32 Warehouse passkeys untouched', (SELECT count(*) FROM warehouse_identity.passkeys)::text = (SELECT v FROM _c WHERE k = 'wh_passkeys'));
END $$;

SELECT format('%s %s%s', CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END, test, CASE WHEN pass OR detail IS NULL THEN '' ELSE '  [' || detail || ']' END) FROM _r ORDER BY n;
SELECT format('SUMMARY 626: %s passed, %s failed, %s total', count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass), count(*)) FROM _r;
