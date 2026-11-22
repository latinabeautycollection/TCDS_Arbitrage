#!/usr/bin/env bash
# STAGING ONLY (kqcdqtazcqaawdkmcfed). Rehearses vendor Recovery V1.9.2 migrations 634-641 in ONE transaction that
# always ends in ROLLBACK - nothing is kept. Each step runs under its own savepoint so one failure does not hide the rest.
#   facts -> (602/602a if staging lacks them) -> 634 -> 635 (as shipped; retried with the 621 owner-membership step if it
#   fails) -> 636 -> 637 -> 638 -> 640 -> 641 -> 639/642/643 vendor checks -> our probes (SET ROLE per runtime role)
#   -> vendor rollbacks + our 635 reversal -> catalog diff vs start -> ROLLBACK -> separate read-only "nothing kept" check.
# Probes: D3 grants/RLS vs the code's queries, D4 stale challenge blocks a contact, D6 635 install permission,
#         insert-column fit of the step-up writes, 635 guard behaviour as tcds_login_api.
# Prints no secrets. Copy first (from the Mac):
#   ssh apifydev@139.177.200.80 'mkdir -p /tmp/recov192' && scp -r ~/Downloads/recov192/{v192_rehearse.sh,sha.txt,sql} apifydev@139.177.200.80:/tmp/recov192/
# Run on the server: bash /tmp/recov192/v192_rehearse.sh
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
D=/tmp/recov192
(cd $D && sha256sum -c --quiet sha.txt) && echo "files: sha256 ok"
rm -rf $D/body; mkdir -p $D/body
for f in $D/sql/*.sql; do grep -vxE 'BEGIN;|COMMIT;' "$f" > "$D/body/$(basename "$f")"; done
echo "target | host=$PGHOST (staging)"

# One step = savepoint + vendor file; on failure roll back to the savepoint and record ok_<name>=0.
step() { local n=$1 f=$2; cat <<EOF
\\echo
\\echo ==== STEP $n ($f)
SAVEPOINT sp_$n;
\\set ON_ERROR_STOP 0
\\set ON_ERROR_ROLLBACK off
\\ir body/$f
\\set ON_ERROR_STOP 1
\\if :ERROR
\\echo !! STEP $n FAILED (first error above) - rolled back to its savepoint
ROLLBACK TO SAVEPOINT sp_$n;
\\set ok_$n 0
\\else
\\echo STEP $n OK
RELEASE SAVEPOINT sp_$n;
\\set ok_$n 1
\\endif
EOF
}

{
cat <<'SQL'
\set ON_ERROR_STOP 1
\pset footer off
\pset null '-'
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
CREATE FUNCTION pg_temp.snap() RETURNS SETOF text LANGUAGE sql AS $s$
 SELECT 'rel:'||c.relname||':'||c.relkind::text FROM pg_class c WHERE c.relnamespace='warehouse_identity'::regnamespace
 UNION ALL SELECT 'col:'||c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'fn:'||p.oid::regprocedure::text||':'||pg_get_userbyid(p.proowner)||':'||coalesce(p.proacl::text,'-')||':'||md5(pg_get_functiondef(p.oid))
   FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace AND p.prokind='f'
 UNION ALL SELECT 'acl:'||c.relname||':'||coalesce(c.relacl::text,'-') FROM pg_class c
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind='r'
 UNION ALL SELECT 'colacl:'||c.relname||'.'||a.attname||':'||a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND a.attacl IS NOT NULL
 UNION ALL SELECT 'trg:'||c.relname||':'||t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND NOT t.tgisinternal
 UNION ALL SELECT 'con:'||coalesce(c.relname,'-')||':'||k.conname||':'||pg_get_constraintdef(k.oid)
   FROM pg_constraint k LEFT JOIN pg_class c ON c.oid=k.conrelid WHERE k.connamespace='warehouse_identity'::regnamespace
 UNION ALL SELECT 'pol:'||tablename||':'||policyname||':'||roles::text||':'||cmd FROM pg_policies WHERE schemaname='warehouse_identity'
 UNION ALL SELECT 'rls:'||c.relname||':'||c.relrowsecurity||':'||c.relforcerowsecurity FROM pg_class c
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind='r'
 UNION ALL SELECT 'role:'||rolname FROM pg_roles WHERE rolname LIKE 'tcds\_recovery%'
 UNION ALL SELECT 'member:'||pg_get_userbyid(roleid)||'>'||pg_get_userbyid(member)||' by '||pg_get_userbyid(grantor)
   ||':'||inherit_option::text||':'||set_option::text||':'||admin_option::text
   FROM pg_auth_members WHERE pg_get_userbyid(member)='postgres'
    AND pg_get_userbyid(roleid) IN ('tcds_identity_function_owner','tcds_login_api')
$s$;
-- Run q as role r; returns 'ok <first column>' or 'ERR <sqlstate> <message>'. The role switch is undone either way.
CREATE FUNCTION pg_temp.as_role(r text, q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
 EXECUTE format('SET LOCAL ROLE %I', r);
 BEGIN EXECUTE q INTO v;
 EXCEPTION WHEN OTHERS THEN EXECUTE 'RESET ROLE'; RETURN 'ERR '||SQLSTATE||' '||left(SQLERRM,110); END;
 EXECUTE 'RESET ROLE'; RETURN 'ok '||coalesce(v,'null');
END $f$;

\echo ==== FACTS (staging, before anything)
SELECT current_setting('server_version') AS pg, current_user AS as_user,
 (SELECT rolbypassrls FROM pg_roles WHERE rolname='postgres') AS postgres_bypassrls,
 (SELECT rolbypassrls FROM pg_roles WHERE rolname='tcds_identity_function_owner') AS fn_owner_bypassrls;
SELECT 'postgres member of '||pg_get_userbyid(roleid)||' (grantor '||pg_get_userbyid(grantor)||') inherit='||inherit_option
  ||' set='||set_option||' admin='||admin_option AS membership
 FROM pg_auth_members WHERE member='postgres'::regrole AND pg_get_userbyid(roleid) IN ('tcds_identity_function_owner','tcds_login_api');
SELECT n AS prerequisite, CASE WHEN n LIKE '%(%' THEN to_regprocedure(n) IS NOT NULL ELSE to_regclass(n) IS NOT NULL END AS present FROM (VALUES
 ('warehouse_identity.recovery_contact_challenges_v1'),('warehouse_identity.recovery_proofs_v1'),('warehouse_identity.user_recovery_contacts'),
 ('warehouse_identity.iam_session_epochs_v15'),('warehouse_identity.password_recovery_stepup_authorizations_v62'),
 ('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'),('warehouse_identity.recovery_consume_supplemental_proof_v15(uuid,uuid,uuid)'),
 ('warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text)'),
 ('warehouse_identity.request_password_recovery_v62(uuid,text,text,uuid,uuid,uuid)'),
 ('warehouse_identity.approve_password_reset_v3(uuid,uuid,bigint,bytea,timestamptz)'),
 ('warehouse_identity.claim_password_reset_token_v5(uuid,bytea,bytea,bytea,bytea)'),
 ('warehouse_identity.consume_password_reset_v5(uuid,bytea,bytea,text,jsonb,uuid,uuid,uuid)')) v(n);
SELECT c.relname AS existing_table, c.relforcerowsecurity AS force_rls,
 (SELECT string_agg(policyname||'->'||roles::text||':'||cmd, '; ') FROM pg_policies p WHERE p.schemaname='warehouse_identity' AND p.tablename=c.relname) AS policies
 FROM pg_class c WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relname IN
 ('auth_sessions','employees','users','password_reset_requests','passkeys','auth_challenges','webauthn_verification_evidence',
  'user_role_assignments','roles','user_recovery_contacts','recovery_contact_challenges_v1','recovery_proofs_v1') ORDER BY 1;
SELECT 'contacts VERIFIED='||count(*) FILTER (WHERE status='VERIFIED')||' total='||count(*) AS recovery_contacts FROM warehouse_identity.user_recovery_contacts;
SELECT 'reset requests by status: '||coalesce(string_agg(status||'='||n, ', '),'none') AS reset_requests
 FROM (SELECT status, count(*) n FROM warehouse_identity.password_reset_requests GROUP BY 1) s;
CREATE TEMP TABLE g621 AS SELECT pg_get_functiondef('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'::regprocedure) AS d;
SELECT 'guard_v15 md5='||md5(d)||' no_supplemental_branch='||(position('NO_SUPPLEMENTAL' IN d)>0) AS guard_before FROM g621;
SELECT has_table_privilege('tcds_identity_function_owner','warehouse_identity.recovery_contact_challenges_v1','SELECT') AS fnowner_had_challenge_select \gset
SELECT to_regprocedure('warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text)') IS NULL AS need602 \gset
\if :need602
\echo ==== 6.2 (602 + 602a) is NOT on staging - installing it inside this rolled-back transaction (634 needs it)
\ir body/602_password_recovery_iam_authority.sql
\ir body/602a_grants.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\echo 602 + 602a installed (temporary)
\else
\echo 6.2 already on staging
\endif
CREATE TEMP TABLE snap0 AS SELECT x FROM pg_temp.snap() x;
SELECT 'catalog snapshot: '||count(*)||' entries' AS snap0 FROM snap0;
SQL

step 634 634_recovery_runtime_v18_STAGING_ONLY.sql
step 635 635_strict_otp_first_gate_STAGING_ONLY.sql
cat <<'SQL'
\if :ok_635
\echo D6: 635 installed as shipped (no owner-membership step needed on staging)
\else
\echo D6 CONFIRMED: 635 as shipped failed. Retrying with the 621 owner-membership step (temporary SET on tcds_identity_function_owner)
DO $m$ BEGIN
 IF NOT pg_has_role('postgres','tcds_identity_function_owner','SET') THEN EXECUTE 'GRANT tcds_identity_function_owner TO postgres WITH SET TRUE'; END IF;
 IF NOT has_schema_privilege('tcds_identity_function_owner','warehouse_identity','CREATE') THEN EXECUTE 'GRANT CREATE ON SCHEMA warehouse_identity TO tcds_identity_function_owner'; END IF;
END $m$;
SQL
step 635retry 635_strict_otp_first_gate_STAGING_ONLY.sql
cat <<'SQL'
\endif
SQL
step 636 636_runtime_grants_REVIEW_ONLY.sql
step 637 637_recovery_runtime_hardening_STAGING_ONLY.sql
step 638 638_issuance_least_privilege_REVIEW_ONLY.sql
step 640 640_browser_bound_otp_claim_STAGING_ONLY.sql
step 641 641_issuance_retry_state_STAGING_ONLY.sql

cat <<'SQL'
\echo
\echo ==== VENDOR READ-ONLY CHECKS (639, 642, 643)
\set ON_ERROR_STOP 0
\set ON_ERROR_ROLLBACK on
\ir body/639_readonly_release_preflight.sql
\ir body/642_v191_readonly_authority_preflight.sql
\ir body/643_staging_RLS_and_authority_gate_READONLY.sql
\if :ERROR
\echo !! 643 gate FAILED (error above) - the gate stops at its first missing grant/policy; full matrix below
\else
\echo 643 gate passed
\endif

\echo
\echo ==== PROBE MATRIX (same pairs as 643, all at once): grant / policy for that role / FORCE RLS
SELECT v.tbl, v.role_name,
 has_table_privilege(v.role_name,'warehouse_identity.'||v.tbl,'SELECT') AS sel_grant,
 has_table_privilege(v.role_name,'warehouse_identity.'||v.tbl,'UPDATE') AS upd_grant,
 (SELECT string_agg(cmd,',') FROM pg_policies p WHERE p.schemaname='warehouse_identity' AND p.tablename=v.tbl AND (v.role_name=ANY(p.roles) OR 'public'=ANY(p.roles))) AS policies,
 c.relforcerowsecurity AS force_rls
FROM (VALUES ('auth_sessions','tcds_recovery_verifier_v18'),('employees','tcds_recovery_verifier_v18'),
 ('password_reset_requests','tcds_recovery_verifier_v18'),('passkeys','tcds_recovery_verifier_v18'),
 ('user_recovery_contacts','tcds_recovery_otp_v18'),('password_reset_requests','tcds_recovery_otp_v18'),
 ('recovery_contact_challenges_v1','tcds_recovery_otp_v18'),('recovery_proofs_v1','tcds_recovery_otp_v18'),
 ('recovery_claim_bindings_v191','tcds_recovery_otp_v18')) v(tbl,role_name)
JOIN pg_class c ON c.relname=v.tbl AND c.relnamespace='warehouse_identity'::regnamespace;

\echo
\echo ==== PROBES AS EACH RUNTIME ROLE (SET ROLE; temporary SET membership for postgres)
DO $g$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['tcds_recovery_verifier_v18','tcds_recovery_otp_v18','tcds_recovery_delivery_v18','tcds_login_api'] LOOP
  IF to_regrole(r) IS NOT NULL AND NOT pg_has_role('postgres',r,'SET') THEN EXECUTE format('GRANT %I TO postgres WITH SET TRUE, INHERIT FALSE',r); END IF;
 END LOOP; END $g$;
SELECT p.id, p.expect, pg_temp.as_role(p.r, p.q) AS result FROM (VALUES
 ('D3a otp: lock reset request (invitation.issue / otp.issue)','ERR 42501 = defect','tcds_recovery_otp_v18',
   'SELECT count(*)::text FROM (SELECT 1 FROM warehouse_identity.password_reset_requests WHERE false FOR UPDATE) x'),
 ('D3a otp: lock recovery contact (otp.issue)','ERR 42501 = defect','tcds_recovery_otp_v18',
   'SELECT count(*)::text FROM (SELECT 1 FROM warehouse_identity.user_recovery_contacts WHERE false FOR UPDATE) x'),
 ('D3a otp: lock challenge (verify)','ok','tcds_recovery_otp_v18',
   'SELECT count(*)::text FROM (SELECT 1 FROM warehouse_identity.recovery_contact_challenges_v1 WHERE false FOR UPDATE) x'),
 ('D3a otp: issuance job lock (worker)','ok','tcds_recovery_otp_v18',
   'SELECT count(*)::text FROM (SELECT 1 FROM warehouse_identity.recovery_issuance_jobs_v19 WHERE false FOR UPDATE SKIP LOCKED) x'),
 ('D3a otp: outbox read for existing-code check','ok','tcds_recovery_otp_v18',
   'SELECT count(*)::text FROM warehouse_identity.recovery_secret_outbox_v18'),
 ('D3b verifier: visible auth_sessions','ok <n> (0 while postgres sees rows = RLS blocks)','tcds_recovery_verifier_v18','SELECT count(*)::text FROM warehouse_identity.auth_sessions'),
 ('D3b postgres: auth_sessions','baseline','postgres','SELECT count(*)::text FROM warehouse_identity.auth_sessions'),
 ('D3b verifier: visible employees','ok <n>','tcds_recovery_verifier_v18','SELECT count(*)::text FROM warehouse_identity.employees'),
 ('D3b postgres: employees','baseline','postgres','SELECT count(*)::text FROM warehouse_identity.employees'),
 ('D3b verifier: visible passkeys','ok <n>','tcds_recovery_verifier_v18','SELECT count(*)::text FROM warehouse_identity.passkeys'),
 ('D3b postgres: passkeys','baseline','postgres','SELECT count(*)::text FROM warehouse_identity.passkeys'),
 ('D3b otp: visible reset requests','ok <n>','tcds_recovery_otp_v18','SELECT count(*)::text FROM warehouse_identity.password_reset_requests'),
 ('D3b postgres: reset requests','baseline','postgres','SELECT count(*)::text FROM warehouse_identity.password_reset_requests'),
 ('D3b verifier: lock passkey (finish)','ok','tcds_recovery_verifier_v18',
   'SELECT count(*)::text FROM (SELECT 1 FROM warehouse_identity.passkeys WHERE false FOR UPDATE) x'),
 ('D3b verifier: lock action challenge (finish)','ok','tcds_recovery_verifier_v18',
   'SELECT count(*)::text FROM (SELECT 1 FROM warehouse_identity.recovery_action_challenges_v18 WHERE false FOR UPDATE) x'),
 ('D3c login_api: users (queue/intake)','which role runs readAndIntake?','tcds_login_api','SELECT count(*)::text FROM warehouse_identity.users'),
 ('D3c login_api: user_role_assignments','-','tcds_login_api','SELECT count(*)::text FROM warehouse_identity.user_role_assignments'),
 ('D3c login_api: password_reset_requests','-','tcds_login_api','SELECT count(*)::text FROM warehouse_identity.password_reset_requests'),
 ('D3d delivery: claim outbox row','ok','tcds_recovery_delivery_v18',
   'SELECT count(*)::text FROM (SELECT 1 FROM warehouse_identity.recovery_secret_outbox_v18 WHERE false FOR UPDATE SKIP LOCKED) x'),
 ('635 guard as login_api, NULL proof','ERR OTP_PROOF_REQUIRED','tcds_login_api',
   'SELECT decision FROM warehouse_identity.recovery_reset_guard_v15(gen_random_uuid(), NULL)'),
 ('635 guard as login_api, unknown request','ERR RESET_INVALID','tcds_login_api',
   'SELECT decision FROM warehouse_identity.recovery_reset_guard_v15(gen_random_uuid(), gen_random_uuid())'),
 ('635 proof gate as login_api','ok false (no permission error)','tcds_login_api',
   'SELECT warehouse_identity.recovery_proof_eligible_v18(gen_random_uuid(), gen_random_uuid())::text')
) p(id,expect,r,q);
SELECT f AS fn_execute, r AS role, has_function_privilege(r, f, 'EXECUTE') AS can_execute FROM (VALUES
 ('warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text)','tcds_recovery_verifier_v18'),
 ('warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text)','tcds_login_api'),
 ('warehouse_identity.request_password_recovery_v62(uuid,text,text,uuid,uuid,uuid)','tcds_login_api'),
 ('warehouse_identity.approve_password_reset_v3(uuid,uuid,bigint,bytea,timestamptz)','tcds_login_api'),
 ('warehouse_identity.recovery_proof_eligible_v18(uuid,uuid)','tcds_recovery_otp_v18'),
 ('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)','tcds_login_api')) v(f,r) WHERE to_regprocedure(f) IS NOT NULL AND to_regrole(r) IS NOT NULL;

\echo
\echo ==== STEP-UP WRITES vs TABLES (required columns the vendor INSERTs do not supply; types; checks)
SELECT c.relname AS tbl, a.attname AS required_not_supplied, format_type(a.atttypid,a.atttypmod) AS type
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
WHERE c.relnamespace='warehouse_identity'::regnamespace AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef
 AND a.attidentity='' AND (
  (c.relname='auth_challenges' AND a.attname NOT IN ('auth_challenge_id','user_id','device_id','ceremony_type','challenge_hash','expected_origin','expected_rp_id','request_id','correlation_id','expires_at'))
  OR (c.relname='webauthn_verification_evidence' AND a.attname NOT IN ('webauthn_verification_evidence_id','auth_challenge_id','ceremony_type','user_id','passkey_id','credential_id','verified_origin','verified_rp_id','user_verified','authenticator_data_sha256','client_data_json_sha256','signature_sha256','prior_sign_count','observed_sign_count','verifier_service','verifier_version','verifier_instance_id','request_id','correlation_id')))
ORDER BY 1,2;
SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid,a.atttypmod) AS type
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
WHERE c.relnamespace='warehouse_identity'::regnamespace AND a.attnum>0 AND NOT a.attisdropped AND (
 (c.relname='webauthn_verification_evidence' AND a.attname IN ('authenticator_data_sha256','client_data_json_sha256','signature_sha256','credential_id','verifier_service','verified_at'))
 OR (c.relname='passkeys' AND a.attname IN ('credential_id','public_key','sign_count','enrolled_device_id','security_state'))
 OR (c.relname='auth_challenges' AND a.attname IN ('challenge_hash','ceremony_type')))
ORDER BY 1,2;
SELECT conrelid::regclass AS tbl, conname, left(pg_get_constraintdef(oid),160) AS check_def FROM pg_constraint
WHERE contype='c' AND conrelid IN ('warehouse_identity.webauthn_verification_evidence'::regclass,'warehouse_identity.auth_challenges'::regclass) ORDER BY 1,2;
SELECT tgrelid::regclass AS tbl, tgname AS trigger FROM pg_trigger
WHERE NOT tgisinternal AND tgrelid IN ('warehouse_identity.webauthn_verification_evidence'::regclass,'warehouse_identity.auth_challenges'::regclass);

\echo
\echo ==== D4: one expired code blocks every later code for that contact (fixture rows, rolled back)
\set ON_ERROR_ROLLBACK off
\set ON_ERROR_STOP 1
SAVEPOINT d4;
DO $d4$
DECLARE u uuid; c uuid; ch uuid; outstanding int; b32 bytea; b16 bytea;
BEGIN
 SELECT user_id INTO u FROM warehouse_identity.users ORDER BY (normalized_username='stg_employee_1') DESC LIMIT 1;
 IF u IS NULL THEN RAISE NOTICE 'D4 skipped: no users on staging'; RETURN; END IF;
 b32 := decode(md5(random()::text)||md5(random()::text),'hex'); b16 := decode(md5(random()::text),'hex');
 -- A PENDING contact is enough: the 604 index is on the challenges, whatever the contact status.
 INSERT INTO warehouse_identity.user_recovery_contacts(user_id,contact_type,ciphertext,iv,tag,value_fingerprint,status)
 VALUES(u,'EMAIL','\x00'::bytea,substring(b16 from 1 for 12),b16,b32,'PENDING') RETURNING contact_id INTO c;
 INSERT INTO warehouse_identity.recovery_contact_challenges_v1(user_id,contact_id,purpose,otp_hash,otp_salt,expires_at,delivery_state)
 VALUES(u,c,'CONTACT_VERIFY',b32,b16,clock_timestamp()+interval '10 minutes','ACCEPTED') RETURNING challenge_id INTO ch;
 UPDATE warehouse_identity.recovery_contact_challenges_v1 SET created_at=clock_timestamp()-interval '20 minutes',
   expires_at=clock_timestamp()-interval '15 minutes' WHERE challenge_id=ch;
 SELECT count(*) INTO outstanding FROM warehouse_identity.recovery_contact_challenges_v1
  WHERE contact_id=c AND consumed_at IS NULL AND expires_at>clock_timestamp() AND delivery_state IN ('PENDING','ACCEPTED','UNKNOWN');
 RAISE NOTICE 'D4 vendor "code already outstanding" check sees % live codes (0 = it will try to send a new one)', outstanding;
 BEGIN
  INSERT INTO warehouse_identity.recovery_contact_challenges_v1(user_id,contact_id,purpose,otp_hash,otp_salt,expires_at,delivery_state)
  VALUES(u,c,'CONTACT_VERIFY',b32,b16,clock_timestamp()+interval '10 minutes','PENDING');
  RAISE NOTICE 'D4 NOT reproduced: a new code was accepted after the old one expired';
 EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'D4 CONFIRMED: new code refused (%) - expired unconsumed code still holds the 604 unique index', SQLERRM;
 END;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'D4 fixture could not be built: % %', SQLSTATE, SQLERRM;
END $d4$;
ROLLBACK TO SAVEPOINT d4;

\echo
\echo ==== ROLLBACK PHASE: vendor rollbacks (640/641, 637, 634) + our reversal of 635 (no vendor rollback exists)
\set ON_ERROR_ROLLBACK off
SQL
step rb640 640_641_rollback_REHEARSAL_ONLY.sql
cat <<'SQL'
\echo
\echo ==== STEP rb635 (ours: restore the saved 621 guard, drop the 635 additions)
SAVEPOINT sp_rb635;
\set ON_ERROR_STOP 0
SELECT d FROM g621 \gexec
DROP FUNCTION IF EXISTS warehouse_identity.recovery_proof_eligible_v18(uuid,uuid);
DROP POLICY IF EXISTS r635_fn_owner_challenges ON warehouse_identity.recovery_contact_challenges_v1;
\if :fnowner_had_challenge_select
\else
REVOKE SELECT ON warehouse_identity.recovery_contact_challenges_v1 FROM tcds_identity_function_owner;
\endif
SELECT 'guard restored, md5 matches before: '||(md5(pg_get_functiondef('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'::regprocedure))=(SELECT md5(d) FROM g621)) AS rb635;
\set ON_ERROR_STOP 1
\if :ERROR
\echo !! rb635 FAILED (error above)
ROLLBACK TO SAVEPOINT sp_rb635;
\else
RELEASE SAVEPOINT sp_rb635;
\endif
SQL
step rb637 637_rollback_STAGING_ONLY.sql
step rb634 634_rollback_STAGING_ONLY.sql
cat <<'SQL'
\echo
\echo ==== CATALOG AFTER ALL ROLLBACKS vs START (leftovers = rollback gaps; postgres memberships we added for probes are excluded)
CREATE TEMP TABLE snap9 AS SELECT x FROM pg_temp.snap() x WHERE x NOT LIKE 'member:%';
DELETE FROM snap0 WHERE x LIKE 'member:%';
SELECT 'LEFT BEHIND + '||x AS diff FROM (SELECT x FROM snap9 EXCEPT SELECT x FROM snap0) a
UNION ALL SELECT 'REMOVED     - '||x FROM (SELECT x FROM snap0 EXCEPT SELECT x FROM snap9) b ORDER BY 1;
SELECT 'catalog identical to start: '||NOT EXISTS((SELECT x FROM snap9 EXCEPT SELECT x FROM snap0) UNION ALL (SELECT x FROM snap0 EXCEPT SELECT x FROM snap9)) AS verdict;
SELECT 'step results: 634='||:ok_634||' 635='||:ok_635||' 636='||:ok_636||' 637='||:ok_637||' 638='||:ok_638||' 640='||:ok_640||' 641='||:ok_641 AS summary;
ROLLBACK;
\echo REHEARSAL ROLLED BACK
SQL
} > $D/rehearse.sql

PAGER=cat psql -X -q -A -F ' | ' -f $D/rehearse.sql 2>&1 \
 | grep -vE 'current transaction is aborted|^$' | sed -E 's/^psql:[^ ]+ (ERROR|NOTICE|WARNING): +/\1: /'

echo
echo "==== AFTER: nothing kept on staging (new session, read-only)"
PAGER=cat psql -X -At -F ' | ' <<'SQL'
SELECT 'v18/v19/v191 tables left: '||count(*) FROM pg_class WHERE relnamespace='warehouse_identity'::regnamespace AND relname ~ '_v1(8|9|91)$';
SELECT 'tcds_recovery_* roles left: '||count(*) FROM pg_roles WHERE rolname LIKE 'tcds\_recovery%';
SELECT 'proof_eligible_v18 present: '||(to_regprocedure('warehouse_identity.recovery_proof_eligible_v18(uuid,uuid)') IS NOT NULL);
SELECT 'guard still has NO_SUPPLEMENTAL branch (621 original): '||(position('NO_SUPPLEMENTAL' IN pg_get_functiondef('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'::regprocedure))>0);
SQL
