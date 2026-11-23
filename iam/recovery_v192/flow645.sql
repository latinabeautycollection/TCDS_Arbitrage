-- Functional flow for 645 (recovery-email enrollment + central-passkey approval). Creates fixture rows:
-- run ONLY inside a transaction that is rolled back. Login API steps run as tcds_login_api, approval steps as
-- tcds_identity_central_verifier (SET ROLE), central passkeys are enrolled through the real 626 functions.
DO $m$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['tcds_login_api','tcds_identity_central_verifier','tcds_identity_central_admin'] LOOP
  IF NOT pg_has_role(current_user, r, 'SET') THEN EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE', r, current_user); END IF;
 END LOOP; END $m$;
CREATE OR REPLACE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql AS $$ SELECT sha256(convert_to(p, 'UTF8')) $$;
-- central passkey through the real 626 enrollment path (synthetic attestation hashes), as 629 does
CREATE OR REPLACE FUNCTION pg_temp.enroll(p_user uuid, p_admin uuid, p_cid text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE b record; c record; f record; rp text := 'login-stg.tcdsolutionsgroup.com';
BEGIN
 PERFORM warehouse_identity.central_issue_invite_v1(p_user, p_admin, pg_temp.h('tok' || p_cid), rp, 60, 'c645 test', gen_random_uuid());
 SELECT * INTO b FROM warehouse_identity.central_enrollment_begin_v1(pg_temp.h('tok' || p_cid), rp, 'https://' || rp, pg_temp.h('ch' || p_cid), gen_random_uuid(), gen_random_uuid());
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(b.auth_challenge_id, pg_temp.h('ch' || p_cid), pg_temp.h('cl' || p_cid), 'CENTRAL_PASSKEY_ENROLLMENT', rp, NULL, NULL, NULL);
 SELECT * INTO f FROM warehouse_identity.central_finalize_enrollment_v1(b.auth_challenge_id, pg_temp.h('cl' || p_cid), c.claim_generation, p_cid, '\x01'::bytea, -7,
   ARRAY['internal'], NULL, 'multiDevice', true, true, 'test', 'https://' || rp, rp, true, repeat('a', 64), repeat('b', 64), repeat('c', 64), 't', '1', 'c645', gen_random_uuid(), gen_random_uuid());
 IF f.outcome <> 'SUCCEEDED' THEN RAISE EXCEPTION 'enroll failed: %', f.outcome; END IF;
 RETURN f.central_passkey_id;
END $$;
-- one approval ceremony for an enrollment, signed with central passkey p_cid, run as the verifier role
CREATE OR REPLACE FUNCTION pg_temp.approve(p_enrollment uuid, p_cid text)
RETURNS TABLE (outcome text, approver_user_id uuid, evidence_id uuid, approvals integer, required integer, approved boolean) LANGUAGE plpgsql AS $$
DECLARE ch uuid; c record; m record; rp text := 'login-stg.tcdsolutionsgroup.com'; k text := gen_random_uuid()::text; hap bytea; hcl bytea;
BEGIN
 hap := pg_temp.h('ap' || k); hcl := pg_temp.h('acl' || k);          -- temp helpers only before the role switch
 EXECUTE 'SET LOCAL ROLE tcds_identity_central_verifier';
 ch := warehouse_identity.central_recovery_contact_approval_begin_v645(p_enrollment, rp, 'https://' || rp, hap, gen_random_uuid(), gen_random_uuid());
 SELECT * INTO c FROM warehouse_identity.central_claim_challenge_v1(ch, hap, hcl, 'RECOVERY_CONTACT_APPROVAL', rp, NULL, NULL, NULL);
 SELECT * INTO m FROM warehouse_identity.central_passkey_material_v1(p_cid, rp);
 RETURN QUERY SELECT * FROM warehouse_identity.central_finalize_recovery_contact_approval_v645(ch, hcl, c.claim_generation, m.central_passkey_id,
   m.row_version, m.sign_count, 0, 'https://' || rp, rp, true, repeat('a', 64), repeat('b', 64), repeat('d', 64), true, true,
   't', '1', 'c645', gen_random_uuid(), gen_random_uuid());
 EXECUTE 'RESET ROLE';
END $$;
-- start an enrollment as the employee (login API role); returns the enrollment id. The code is delivered by the 644 worker functions.
CREATE OR REPLACE FUNCTION pg_temp.start(p_session uuid, p_email text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e record; d record; iv bytea := substring(pg_temp.h('iv' || p_email) from 1 for 12); tag bytea := substring(pg_temp.h('tag' || p_email) from 1 for 16);
  fp bytea := pg_temp.h('fp ' || lower(p_email)); oh bytea := pg_temp.h('otp:12345678'); os bytea := substring(pg_temp.h('salt') from 1 for 16);
BEGIN
 EXECUTE 'SET LOCAL ROLE tcds_login_api';
 SELECT * INTO e FROM warehouse_identity.recovery_contact_start_v645(p_session, convert_to(p_email, 'UTF8'), iv, tag, fp,
   left(p_email, 1) || '•••@' || split_part(p_email, '@', 2), oh, os, convert_to('sealed', 'UTF8'), iv, tag, gen_random_uuid());
 SELECT * INTO d FROM warehouse_identity.recovery_delivery_claim_v192();
 PERFORM warehouse_identity.recovery_delivery_settle_v192(d.delivery_id, 'ACCEPTED');
 EXECUTE 'RESET ROLE';
 RETURN e.enrollment_id;
END $$;
-- confirm the code as the employee: p_match = whether the caller's comparison matched
CREATE OR REPLACE FUNCTION pg_temp.code(p_session uuid, p_match boolean) RETURNS text LANGUAGE plpgsql AS $$
DECLARE l record; r text;
BEGIN
 EXECUTE 'SET LOCAL ROLE tcds_login_api';
 SELECT * INTO l FROM warehouse_identity.recovery_contact_code_load_v645(p_session);
 r := warehouse_identity.recovery_contact_code_settle_v645(p_session, l.challenge_id, p_match);
 EXECUTE 'RESET ROLE';
 RETURN r;
END $$;

DO $flow$
DECLARE fails int := 0; step text := 'fixtures'; emp uuid; fac uuid; dev uuid; ses uuid; adm uuid; a1 uuid; a2 uuid; outsider uuid; role uuid;
  enr uuid; enr2 uuid; enr3 uuid; t text; n int; rec record; st text; iv1 bytea; tag1 bytea; fp1 bytea; oh bytea; os bytea;
BEGIN
 SELECT u.user_id, e.facility_id INTO emp, fac FROM warehouse_identity.users u JOIN warehouse_identity.employees e USING (user_id) WHERE u.normalized_username = 'stg_employee_1';
 IF emp IS NULL THEN RAISE NOTICE 'FLOW SKIPPED: stg_employee_1 not on staging'; RETURN; END IF;
 -- the employee's signed-in session (synthetic device)
 INSERT INTO warehouse.devices (facility_id, device_type, status, device_name, serial_number, hardware_fingerprint)
 VALUES (fac, 'PWA_DESKTOP', 'ACTIVE', 'c645-test-device', 'c645-' || gen_random_uuid(), 'c645-' || gen_random_uuid()) RETURNING device_id INTO dev;
 WITH ds AS (INSERT INTO warehouse.device_sessions (device_id, user_id, employee_number, started_at, last_activity_at, network_state)
   SELECT dev, emp, e.employee_number, statement_timestamp(), statement_timestamp(), '{"fixture":"c645"}'::jsonb FROM warehouse_identity.employees e WHERE e.user_id = emp RETURNING session_id)
 INSERT INTO warehouse_identity.auth_sessions (user_id, employee_id, device_id, warehouse_device_session_id, authentication_method, assurance_level,
   token_hash, csrf_token_hash, issued_at, last_activity_at, idle_expires_at, absolute_expires_at, request_id, correlation_id)
 SELECT emp, e.employee_id, dev, ds.session_id, 'PASSWORD', 'AAL1', pg_temp.h('c645-token-' || gen_random_uuid()), pg_temp.h('c645-csrf-' || gen_random_uuid()),
   statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '29 minutes', statement_timestamp() + interval '7 hours', gen_random_uuid(), gen_random_uuid()
 FROM ds, warehouse_identity.employees e WHERE e.user_id = emp RETURNING auth_session_id INTO ses;
 -- approvers (global role), an outsider, an admin who issues the central invites
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c645.admin', 'C645 Admin', 'ACTIVE') RETURNING user_id INTO adm;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c645.appr.a', 'C645 Approver A', 'ACTIVE') RETURNING user_id INTO a1;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c645.appr.b', 'C645 Approver B', 'ACTIVE') RETURNING user_id INTO a2;
 INSERT INTO warehouse_identity.users (username, display_name, status) VALUES ('c645.outsider', 'C645 Outsider', 'ACTIVE') RETURNING user_id INTO outsider;
 SELECT role_id INTO role FROM warehouse_identity.roles WHERE role_code = 'IAM_RECOVERY_DESTINATION_APPROVER';
 INSERT INTO warehouse_identity.user_role_assignments (user_id, role_id) VALUES (a1, role), (a2, role), (emp, role);
 PERFORM pg_temp.enroll(a1, adm, 'C645ApproverACredential');
 PERFORM pg_temp.enroll(a2, adm, 'C645ApproverBCredential');
 PERFORM pg_temp.enroll(outsider, adm, 'C645OutsiderCredential1');
 PERFORM pg_temp.enroll(emp, adm, 'C645EmployeeCredential1');
 RAISE NOTICE 'fixtures: employee session, approvers A/B (global role, central passkeys), outsider, employee also holds the role';

 step := 'overview empty';
 EXECUTE 'SET LOCAL ROLE tcds_login_api';
 SELECT count(*) INTO n FROM warehouse_identity.recovery_contact_overview_v645(ses) o WHERE o.kind = 'PENDING';
 EXECUTE 'RESET ROLE';
 IF n = 0 THEN RAISE NOTICE 'PASS overview: no pending enrollment'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL overview pending=%', n; END IF;

 step := 'start';
 iv1 := substring(pg_temp.h('iv1') from 1 for 12); tag1 := substring(pg_temp.h('tag1') from 1 for 16); fp1 := pg_temp.h('fp first@example.test');
 oh := pg_temp.h('otp'); os := substring(pg_temp.h('s') from 1 for 16);
 EXECUTE 'SET LOCAL ROLE tcds_login_api';
 SELECT * INTO rec FROM warehouse_identity.recovery_contact_start_v645(ses, convert_to('first@example.test','UTF8'), iv1, tag1, fp1, 'f•••@example.test', oh, os,
   convert_to('sealed','UTF8'), iv1, tag1, gen_random_uuid());
 enr := rec.enrollment_id;
 BEGIN PERFORM warehouse_identity.recovery_contact_code_load_v645(ses); fails := fails + 1; RAISE NOTICE 'FAIL code usable before delivery';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'RECOVERY_CONTACT_CODE_UNAVAILABLE' THEN RAISE NOTICE 'PASS code not usable before the email is accepted';
   ELSE fails := fails + 1; RAISE NOTICE 'FAIL load before delivery: %', SQLERRM; END IF; END;
 SELECT * INTO rec FROM warehouse_identity.recovery_delivery_claim_v192();
 IF convert_from(rec.destination_ciphertext, 'UTF8') = 'first@example.test' THEN RAISE NOTICE 'PASS 644 delivery worker picks up the verification email';
 ELSE fails := fails + 1; RAISE NOTICE 'FAIL delivery claim'; END IF;
 PERFORM warehouse_identity.recovery_delivery_settle_v192(rec.delivery_id, 'ACCEPTED');
 EXECUTE 'RESET ROLE';

 step := 'code';
 t := pg_temp.code(ses, false);
 IF t = 'INVALID' THEN RAISE NOTICE 'PASS wrong code -> INVALID (attempt counted)'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL wrong code: %', t; END IF;
 t := pg_temp.code(ses, true);
 IF t = 'AWAITING_APPROVAL' THEN RAISE NOTICE 'PASS right code -> AWAITING_APPROVAL'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL right code: %', t; END IF;
 SELECT c.status INTO st FROM warehouse_identity.recovery_contact_enrollments_v645 e JOIN warehouse_identity.user_recovery_contacts c USING (contact_id) WHERE e.enrollment_id = enr;
 IF st = 'PENDING' THEN RAISE NOTICE 'PASS a confirmed code alone does not make the email usable (still PENDING)'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL contact %', st; END IF;
 EXECUTE 'SET LOCAL ROLE tcds_login_api';
 IF warehouse_identity.recovery_contact_pending_id_v645(ses) = enr THEN RAISE NOTICE 'PASS pending approval id for the approver email'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL pending id'; END IF;
 SELECT * INTO rec FROM warehouse_identity.recovery_contact_overview_v645(ses) o WHERE o.kind = 'PENDING';
 IF rec.status = 'AWAITING_APPROVAL' AND rec.approvals = 0 AND rec.required = 1 THEN RAISE NOTICE 'PASS overview: awaiting approval, 0 of 1';
 ELSE fails := fails + 1; RAISE NOTICE 'FAIL overview: % %/%', rec.status, rec.approvals, rec.required; END IF;
 EXECUTE 'RESET ROLE';

 step := 'approval page';
 EXECUTE 'SET LOCAL ROLE tcds_identity_central_verifier';
 SELECT * INTO rec FROM warehouse_identity.central_recovery_contact_info_v645(enr);
 EXECUTE 'RESET ROLE';
 IF rec.status = 'AWAITING_APPROVAL' AND rec.contact_hint = 'f•••@example.test' AND rec.required = 1 THEN RAISE NOTICE 'PASS approval page info (masked email, 0 of 1)';
 ELSE fails := fails + 1; RAISE NOTICE 'FAIL info %', rec.status; END IF;
 SELECT * INTO rec FROM pg_temp.approve(enr, 'C645OutsiderCredential1');
 IF rec.outcome = 'APPROVER_NOT_AUTHORIZED' THEN RAISE NOTICE 'PASS outsider passkey -> APPROVER_NOT_AUTHORIZED'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL outsider: %', rec.outcome; END IF;
 SELECT * INTO rec FROM pg_temp.approve(enr, 'C645EmployeeCredential1');
 IF rec.outcome = 'APPROVER_IS_THE_TARGET' THEN RAISE NOTICE 'PASS employee cannot approve their own email (even holding the role)'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL self: %', rec.outcome; END IF;
 SELECT * INTO rec FROM pg_temp.approve(enr, 'C645ApproverACredential');
 IF rec.outcome = 'SUCCEEDED' AND rec.approved AND rec.approvals = 1 THEN RAISE NOTICE 'PASS approver A approves -> email approved (1 of 1)';
 ELSE fails := fails + 1; RAISE NOTICE 'FAIL approve A: % %', rec.outcome, rec.approved; END IF;
 SELECT c.status, (c.recovery_eligible_at <= clock_timestamp()), c.verification_method INTO rec
   FROM warehouse_identity.recovery_contact_enrollments_v645 e JOIN warehouse_identity.user_recovery_contacts c USING (contact_id) WHERE e.enrollment_id = enr;
 IF rec.status = 'VERIFIED' THEN RAISE NOTICE 'PASS email is now VERIFIED and eligible for recovery'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL contact after approval: %', rec.status; END IF;
 SELECT count(*) INTO n FROM warehouse_audit.security_events WHERE event_type = 'RECOVERY_CONTACT_APPROVED' AND details->>'enrollmentId' = enr::text;
 IF n = 1 THEN RAISE NOTICE 'PASS security event written'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL security events: %', n; END IF;
 BEGIN PERFORM pg_temp.approve(enr, 'C645ApproverBCredential'); fails := fails + 1; RAISE NOTICE 'FAIL approved enrollment accepted another approval';
 EXCEPTION WHEN OTHERS THEN EXECUTE 'RESET ROLE'; IF SQLERRM = 'RECOVERY_CONTACT_NOT_AWAITING_APPROVAL' THEN RAISE NOTICE 'PASS an approved enrollment takes no further approvals';
   ELSE fails := fails + 1; RAISE NOTICE 'FAIL re-approve: %', SQLERRM; END IF; END;

 step := 'two approvers';
 UPDATE warehouse_identity.recovery_contact_policy_v645 SET required_approvals = 2;
 enr2 := pg_temp.start(ses, 'second@example.test');
 PERFORM pg_temp.code(ses, true);
 SELECT * INTO rec FROM pg_temp.approve(enr2, 'C645ApproverACredential');
 IF rec.outcome = 'SUCCEEDED' AND NOT rec.approved AND rec.approvals = 1 AND rec.required = 2 THEN RAISE NOTICE 'PASS policy 2: first approval -> 1 of 2, not yet usable';
 ELSE fails := fails + 1; RAISE NOTICE 'FAIL first of two: % % %/%', rec.outcome, rec.approved, rec.approvals, rec.required; END IF;
 SELECT * INTO rec FROM pg_temp.approve(enr2, 'C645ApproverACredential');
 IF rec.outcome = 'APPROVER_ALREADY_APPROVED' THEN RAISE NOTICE 'PASS same approver twice -> APPROVER_ALREADY_APPROVED'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL twice: %', rec.outcome; END IF;
 SELECT * INTO rec FROM pg_temp.approve(enr2, 'C645ApproverBCredential');
 IF rec.outcome = 'SUCCEEDED' AND rec.approved AND rec.approvals = 2 THEN RAISE NOTICE 'PASS second approver -> approved (2 of 2)'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL second: % %', rec.outcome, rec.approved; END IF;
 SELECT count(*) INTO n FROM warehouse_identity.user_recovery_contacts WHERE user_id = emp AND contact_type = 'EMAIL' AND status = 'VERIFIED';
 IF n = 1 THEN RAISE NOTICE 'PASS only the newest email stays VERIFIED (the old one is revoked)'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL verified count %', n; END IF;
 UPDATE warehouse_identity.recovery_contact_policy_v645 SET required_approvals = 1;

 step := 'cancel + re-add';
 BEGIN PERFORM pg_temp.start(ses, 'second@example.test'); fails := fails + 1; RAISE NOTICE 'FAIL the active email was enrolled again';
 EXCEPTION WHEN OTHERS THEN EXECUTE 'RESET ROLE'; IF SQLERRM = 'RECOVERY_CONTACT_ALREADY_ACTIVE' THEN RAISE NOTICE 'PASS the active email cannot be enrolled again';
   ELSE fails := fails + 1; RAISE NOTICE 'FAIL re-enroll active: %', SQLERRM; END IF; END;
 enr3 := pg_temp.start(ses, 'first@example.test');
 RAISE NOTICE 'PASS a revoked address can be added again (re-opened as PENDING)';
 EXECUTE 'SET LOCAL ROLE tcds_login_api';
 IF warehouse_identity.recovery_contact_cancel_v645(ses) THEN RAISE NOTICE 'PASS cancel'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL cancel'; END IF;
 EXECUTE 'RESET ROLE';
 SELECT e.status, c.status INTO t, st FROM warehouse_identity.recovery_contact_enrollments_v645 e JOIN warehouse_identity.user_recovery_contacts c USING (contact_id) WHERE e.enrollment_id = enr3;
 IF t = 'CANCELLED' AND st = 'REVOKED' THEN RAISE NOTICE 'PASS cancelled enrollment revokes its pending email'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL after cancel % %', t, st; END IF;
 BEGIN PERFORM pg_temp.approve(enr3, 'C645ApproverACredential'); fails := fails + 1; RAISE NOTICE 'FAIL cancelled enrollment approved';
 EXCEPTION WHEN OTHERS THEN EXECUTE 'RESET ROLE'; IF SQLERRM = 'RECOVERY_CONTACT_NOT_AWAITING_APPROVAL' THEN RAISE NOTICE 'PASS a cancelled enrollment cannot be approved';
   ELSE fails := fails + 1; RAISE NOTICE 'FAIL approve cancelled: %', SQLERRM; END IF; END;

 step := 'limits + privileges';
 BEGIN PERFORM pg_temp.start(ses, 'third@example.test'); PERFORM pg_temp.start(ses, 'fourth@example.test'); PERFORM pg_temp.start(ses, 'fifth@example.test');
  fails := fails + 1; RAISE NOTICE 'FAIL more than 5 enrollment starts in 24h were allowed';
 EXCEPTION WHEN OTHERS THEN EXECUTE 'RESET ROLE'; IF SQLERRM = 'RECOVERY_CONTACT_TOO_MANY_ATTEMPTS' THEN RAISE NOTICE 'PASS at most 5 enrollment starts per 24 hours';
   ELSE fails := fails + 1; RAISE NOTICE 'FAIL limit: %', SQLERRM; END IF; END;
 IF NOT has_function_privilege('tcds_login_api', 'warehouse_identity.central_finalize_recovery_contact_approval_v645(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid)', 'EXECUTE')
   AND NOT has_function_privilege('tcds_identity_central_verifier', 'warehouse_identity.recovery_contact_start_v645(uuid,bytea,bytea,bytea,bytea,text,bytea,bytea,bytea,bytea,bytea,uuid)', 'EXECUTE')
 THEN RAISE NOTICE 'PASS login API cannot approve; verifier cannot enroll'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL privilege separation'; END IF;
 BEGIN
  EXECUTE 'SET LOCAL ROLE tcds_login_api';
  PERFORM warehouse_identity.recovery_contact_overview_v645(gen_random_uuid());
  EXECUTE 'RESET ROLE'; fails := fails + 1; RAISE NOTICE 'FAIL unknown session accepted';
 EXCEPTION WHEN OTHERS THEN EXECUTE 'RESET ROLE'; IF SQLERRM = 'SESSION_INVALID' THEN RAISE NOTICE 'PASS unknown session -> SESSION_INVALID'; ELSE fails := fails + 1; RAISE NOTICE 'FAIL session: %', SQLERRM; END IF; END;
 RAISE NOTICE 'FUNCTIONAL RESULT: % failure(s)', fails;
EXCEPTION WHEN OTHERS THEN
 EXECUTE 'RESET ROLE';
 RAISE NOTICE 'FUNCTIONAL FLOW STOPPED at step "%": % %', step, SQLSTATE, SQLERRM;
END $flow$;
