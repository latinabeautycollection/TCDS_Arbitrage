-- Functional flow for Recovery V1.9.2 + 644 as tcds_login_api. Creates fixture rows: run ONLY inside a transaction that is rolled back.
DO $flow$
DECLARE
 fails int := 0; step text := 'start'; emp uuid; appr uuid; fac uuid; req uuid; rv bigint; contact uuid; t text; b boolean;
 ch uuid; ch2 uuid; ch3 uuid; del uuid; del2 uuid; del3 uuid; proof uuid; proof2 uuid; u uuid; n int; ts timestamptz; rec record;
 h32 bytea := sha256(convert_to('rehearsal-otp','UTF8')); salt bytea := substring(sha256(convert_to('salt','UTF8')) from 1 for 16);
 bind bytea := sha256(convert_to('browser-a','UTF8')); bind2 bytea := sha256(convert_to('browser-b','UTF8'));
 ref bytea := sha256(convert_to('invitation-ref','UTF8')); iv bytea := substring(sha256(convert_to('iv','UTF8')) from 1 for 12);
 tag bytea := substring(sha256(convert_to('tag','UTF8')) from 1 for 16); dest bytea := convert_to('sealed-destination','UTF8');
BEGIN
 SELECT user_id INTO emp FROM warehouse_identity.users WHERE normalized_username='stg_employee_1';
 SELECT user_id INTO appr FROM warehouse_identity.users WHERE normalized_username='stg_approver_1';
 IF emp IS NULL OR appr IS NULL THEN RAISE NOTICE 'FLOW SKIPPED: stg_employee_1 / stg_approver_1 not on staging'; RETURN; END IF;
 SELECT facility_id INTO fac FROM warehouse_identity.employees WHERE user_id=emp;
 -- fixture: lift the 24h limit for this rehearsal only
 UPDATE warehouse_identity.password_reset_requests SET created_at = created_at - interval '25 hours'
  WHERE user_id=emp AND request_type='SELF_SERVICE' AND created_at > clock_timestamp() - interval '24 hours';

 EXECUTE 'SET LOCAL ROLE tcds_login_api';
 step := 'intake unknown';
 t := warehouse_identity.recovery_intake_v192('no_such_user_rehearsal','FORGOT_PASSWORD','',gen_random_uuid(),gen_random_uuid());
 IF t='NO_ACCOUNT' THEN RAISE NOTICE 'PASS intake unknown account -> NO_ACCOUNT'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL intake unknown: %',t; END IF;
 step := 'intake';
 t := warehouse_identity.recovery_intake_v192('stg_employee_1','FORGOT_PASSWORD','rehearsal',gen_random_uuid(),gen_random_uuid());
 IF t='ACCEPTED' THEN RAISE NOTICE 'PASS intake -> ACCEPTED'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL intake: %',t; END IF;
 t := warehouse_identity.recovery_intake_v192('STG_EMPLOYEE_1','FORGOT_PASSWORD','again',gen_random_uuid(),gen_random_uuid());
 IF t='LIMITED' THEN RAISE NOTICE 'PASS second intake within 24h -> LIMITED (D10: no error reaches HTTP)'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL second intake: %',t; END IF;
 step := 'queue';
 SELECT count(*) INTO n FROM warehouse_identity.recovery_queue_v192(gen_random_uuid(), fac, 'warehouse:identity:password:reset_approve', NULL, NULL, NULL, 25);
 IF n=0 THEN RAISE NOTICE 'PASS queue with an unknown session -> 0 rows'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL queue unknown session: % rows',n; END IF;
 BEGIN PERFORM warehouse_identity.recovery_stepup_options_v192(gen_random_uuid(),gen_random_uuid(),fac,'WAREHOUSE_PASSWORD_RESET_APPROVAL',gen_random_uuid());
  fails:=fails+1; RAISE NOTICE 'FAIL step-up options with unknown session: no error';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='STEPUP_SESSION_INVALID' THEN RAISE NOTICE 'PASS step-up options, unknown session -> STEPUP_SESSION_INVALID';
  ELSE fails:=fails+1; RAISE NOTICE 'FAIL step-up options: %',SQLERRM; END IF; END;
 BEGIN PERFORM warehouse_identity.recovery_stepup_load_v192(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'x');
  fails:=fails+1; RAISE NOTICE 'FAIL step-up load random: no error';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='STEPUP_CHALLENGE_INVALID' THEN RAISE NOTICE 'PASS step-up load, unknown challenge -> STEPUP_CHALLENGE_INVALID';
  ELSE fails:=fails+1; RAISE NOTICE 'FAIL step-up load: %',SQLERRM; END IF; END;
 BEGIN EXECUTE 'SELECT count(*) FROM warehouse_identity.recovery_secret_outbox_v18' INTO n; fails:=fails+1; RAISE NOTICE 'FAIL login_api can read the outbox directly';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS login_api has no direct table access (outbox)'; END;
 EXECUTE 'RESET ROLE';

 SELECT password_reset_request_id, row_version INTO req, rv FROM warehouse_identity.password_reset_requests
  WHERE user_id=emp AND status='REQUESTED' ORDER BY created_at DESC LIMIT 1;
 EXECUTE 'SET LOCAL ROLE tcds_login_api';
 step := 'eligible (no contact)';
 b := warehouse_identity.recovery_contact_eligible_v192(req,'EMAIL');
 IF NOT b THEN RAISE NOTICE 'PASS no verified contact -> not eligible'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL eligible without contact'; END IF;
 EXECUTE 'RESET ROLE';
 -- fixture: a verified recovery email for stg_employee_1 (enrollment flow is not built yet)
 INSERT INTO warehouse_identity.user_recovery_contacts(user_id,contact_type,ciphertext,iv,tag,value_fingerprint,status,verification_method,
   verified_at,recovery_eligible_at,created_at)
 VALUES(emp,'EMAIL',dest,iv,tag,sha256(convert_to('rehearsal-contact','UTF8')),'VERIFIED','SUPERVISED',clock_timestamp(),
   clock_timestamp()-interval '1 minute',clock_timestamp()-interval '2 minutes') RETURNING contact_id INTO contact;

 EXECUTE 'SET LOCAL ROLE tcds_login_api';
 step := 'eligible';
 b := warehouse_identity.recovery_contact_eligible_v192(req,'EMAIL');
 IF b THEN RAISE NOTICE 'PASS verified contact -> eligible'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL eligible with contact'; END IF;
 step := 'issuance intent';
 t := warehouse_identity.recovery_issuance_intent_v192(req, gen_random_uuid());
 IF t='RECORDED' THEN RAISE NOTICE 'PASS issuance intent -> RECORDED'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL intent: %',t; END IF;
 t := warehouse_identity.recovery_issuance_intent_v192(req, gen_random_uuid());
 IF t='EXISTS' THEN RAISE NOTICE 'PASS repeated intent -> EXISTS'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL repeated intent: %',t; END IF;
 SELECT count(*) INTO n FROM warehouse_identity.recovery_issuance_lease_v192();
 IF n=0 THEN RAISE NOTICE 'PASS lease before approval -> nothing'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL lease before approval: %',n; END IF;
 EXECUTE 'RESET ROLE';
 -- fixture: approval (the real path is approve_password_reset_v3 after a passkey step-up; no staging session/passkey yet)
 step := 'fixture approval';
 UPDATE warehouse_identity.password_reset_requests SET status='TOKEN_ISSUED', approved_by=appr, token_hash=sha256(convert_to('rehearsal-token','UTF8')),
   expires_at=clock_timestamp()+interval '20 minutes', row_version=row_version+1 WHERE password_reset_request_id=req;

 EXECUTE 'SET LOCAL ROLE tcds_login_api';
 step := 'lease';
 SELECT * INTO rec FROM warehouse_identity.recovery_issuance_lease_v192();
 IF rec.reset_request_id=req AND rec.code_status='NONE' THEN RAISE NOTICE 'PASS lease after approval -> this reset, no code yet';
 ELSE fails:=fails+1; RAISE NOTICE 'FAIL lease: % %',rec.reset_request_id,rec.code_status; END IF;
 step := 'invitation';
 ts := warehouse_identity.recovery_invitation_issue_v192(req, ref);
 u := warehouse_identity.recovery_invitation_resolve_v192(ref);
 IF u=req THEN RAISE NOTICE 'PASS invitation issued (expires %) and resolves', to_char(ts,'HH24:MI:SS'); ELSE fails:=fails+1; RAISE NOTICE 'FAIL invitation resolve'; END IF;
 step := 'otp issue';
 SELECT challenge_id, delivery_id INTO ch, del FROM warehouse_identity.recovery_otp_issue_v192(req,'EMAIL',h32,salt,convert_to('sealed-code','UTF8'),iv,tag,gen_random_uuid());
 IF ch IS NOT NULL THEN RAISE NOTICE 'PASS code issued'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL code issue'; END IF;
 BEGIN PERFORM warehouse_identity.recovery_otp_issue_v192(req,'EMAIL',h32,salt,convert_to('sealed-code','UTF8'),iv,tag,gen_random_uuid());
  fails:=fails+1; RAISE NOTICE 'FAIL second live code was issued';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='RECOVERY_CHALLENGE_ALREADY_OUTSTANDING' THEN RAISE NOTICE 'PASS second live code refused';
  ELSE fails:=fails+1; RAISE NOTICE 'FAIL second code: %',SQLERRM; END IF; END;
 PERFORM warehouse_identity.recovery_issuance_settle_v192(req,'PREPARED');
 RAISE NOTICE 'PASS issuance job settled PREPARED';
 step := 'otp before delivery';
 BEGIN PERFORM warehouse_identity.recovery_otp_load_v192(req); fails:=fails+1; RAISE NOTICE 'FAIL code usable before the provider accepted it';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='OTP_UNAVAILABLE' THEN RAISE NOTICE 'PASS code not usable before delivery is accepted';
  ELSE fails:=fails+1; RAISE NOTICE 'FAIL load before delivery: %',SQLERRM; END IF; END;
 step := 'delivery claim';
 SELECT * INTO rec FROM warehouse_identity.recovery_delivery_claim_v192();
 IF rec.delivery_id=del AND rec.destination_ciphertext=dest THEN RAISE NOTICE 'PASS delivery claimed with the contact destination';
 ELSE fails:=fails+1; RAISE NOTICE 'FAIL delivery claim'; END IF;
 PERFORM warehouse_identity.recovery_delivery_settle_v192(del,'ACCEPTED');
 EXECUTE 'RESET ROLE';
 SELECT (encrypted_payload IS NULL AND status='ACCEPTED') INTO b FROM warehouse_identity.recovery_secret_outbox_v18 WHERE delivery_id=del;
 IF b THEN RAISE NOTICE 'PASS delivery ACCEPTED and payload scrubbed'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL delivery settle'; END IF;

 EXECUTE 'SET LOCAL ROLE tcds_login_api';
 step := 'otp verify';
 SELECT challenge_id INTO u FROM warehouse_identity.recovery_otp_load_v192(req);
 proof := warehouse_identity.recovery_otp_settle_v192(req, u, false, bind);
 IF proof IS NULL THEN RAISE NOTICE 'PASS wrong code -> no proof'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL wrong code gave a proof'; END IF;
 SELECT challenge_id INTO u FROM warehouse_identity.recovery_otp_load_v192(req);
 proof := warehouse_identity.recovery_otp_settle_v192(req, u, true, bind);
 IF proof IS NOT NULL THEN RAISE NOTICE 'PASS right code -> proof bound to browser A'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL right code'; END IF;
 IF warehouse_identity.recovery_bound_proof_v192(req, bind)=proof AND warehouse_identity.recovery_bound_proof_v192(req, bind2) IS NULL
 THEN RAISE NOTICE 'PASS proof found for browser A only'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL browser binding lookup'; END IF;
 IF warehouse_identity.recovery_proof_eligible_v18(req, proof) THEN RAISE NOTICE 'PASS 635 proof gate accepts the proof';
 ELSE fails:=fails+1; RAISE NOTICE 'FAIL 635 proof gate'; END IF;
 step := 'guard';
 SELECT decision INTO t FROM warehouse_identity.recovery_reset_guard_v15(req, proof);
 IF t='REQUIRE_SUPPLEMENTAL' THEN RAISE NOTICE 'PASS 635 guard accepts and consumes the proof'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL guard: %',t; END IF;
 BEGIN PERFORM warehouse_identity.recovery_reset_guard_v15(req, proof); fails:=fails+1; RAISE NOTICE 'FAIL proof reused';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='OTP_PROOF_REQUIRED' THEN RAISE NOTICE 'PASS proof cannot be reused';
  ELSE fails:=fails+1; RAISE NOTICE 'FAIL proof reuse: %',SQLERRM; END IF; END;

 step := 'D4';
 SELECT challenge_id, delivery_id INTO ch2, del2 FROM warehouse_identity.recovery_otp_issue_v192(req,'EMAIL',h32,salt,convert_to('sealed-code-2','UTF8'),iv,tag,gen_random_uuid());
 EXECUTE 'RESET ROLE';
 UPDATE warehouse_identity.recovery_contact_challenges_v1 SET created_at=clock_timestamp()-interval '20 minutes', expires_at=clock_timestamp()-interval '15 minutes' WHERE challenge_id=ch2;
 UPDATE warehouse_identity.recovery_secret_outbox_v18 SET status='FAILED', encrypted_payload=NULL, payload_iv=NULL, payload_tag=NULL WHERE delivery_id=del2;
 EXECUTE 'SET LOCAL ROLE tcds_login_api';
 BEGIN
  SELECT challenge_id, delivery_id INTO ch3, del3 FROM warehouse_identity.recovery_otp_issue_v192(req,'EMAIL',h32,salt,convert_to('sealed-code-3','UTF8'),iv,tag,gen_random_uuid());
  RAISE NOTICE 'PASS D4 fixed: a new code is issued after the previous one expired';
 EXCEPTION WHEN OTHERS THEN fails:=fails+1; RAISE NOTICE 'FAIL D4: %',SQLERRM; END;
 step := 'D9';
 IF ch3 IS NOT NULL THEN
  SELECT * INTO rec FROM warehouse_identity.recovery_delivery_claim_v192();
  PERFORM warehouse_identity.recovery_delivery_settle_v192(rec.delivery_id,'ACCEPTED');
  SELECT challenge_id INTO u FROM warehouse_identity.recovery_otp_load_v192(req);
  BEGIN proof2 := warehouse_identity.recovery_otp_settle_v192(req, u, true, bind2);
   IF proof2 IS NOT NULL AND warehouse_identity.recovery_bound_proof_v192(req, bind2)=proof2 THEN RAISE NOTICE 'PASS D9 fixed: second proof for the same reset binds to browser B';
   ELSE fails:=fails+1; RAISE NOTICE 'FAIL D9: no second proof'; END IF;
  EXCEPTION WHEN OTHERS THEN fails:=fails+1; RAISE NOTICE 'FAIL D9: %',SQLERRM; END;
 END IF;
 step := 'quarantine + revoke';
 n := warehouse_identity.recovery_delivery_quarantine_v192(60);
 IF n=0 THEN RAISE NOTICE 'PASS quarantine finds nothing stuck'; ELSE fails:=fails+1; RAISE NOTICE 'FAIL quarantine: %',n; END IF;
 n := warehouse_identity.recovery_invitation_revoke_v192(req);
 IF n=1 AND warehouse_identity.recovery_invitation_resolve_v192(ref) IS NULL THEN RAISE NOTICE 'PASS invitation revoked';
 ELSE fails:=fails+1; RAISE NOTICE 'FAIL invitation revoke: %',n; END IF;
 EXECUTE 'RESET ROLE';
 RAISE NOTICE 'FUNCTIONAL RESULT: % failure(s)', fails;
EXCEPTION WHEN OTHERS THEN
 EXECUTE 'RESET ROLE';
 RAISE NOTICE 'FUNCTIONAL FLOW STOPPED at step "%": % %', step, SQLSTATE, SQLERRM;
END $flow$;
