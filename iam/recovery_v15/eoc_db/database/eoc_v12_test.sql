-- STAGING ONLY. Runs inside a transaction the caller rolls back: synthetic UUIDs, nothing is kept.
-- Each check runs as the real EOC role (SET ROLE) and prints PASS/FAIL, the check, and what came back.
SET LOCAL search_path = pg_catalog, pg_temp;
CREATE FUNCTION pg_temp.as_role(r text, s text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
 EXECUTE format('SET LOCAL ROLE %I', r);
 IF s ~* '^\s*(select|with)\M' THEN EXECUTE s INTO v; ELSE EXECUTE s; v := 'OK'; END IF;
 RESET ROLE;
 RETURN coalesce(v, 'NULL');
EXCEPTION WHEN OTHERS THEN
 RETURN 'ERR: ' || SQLERRM;
END $f$;
CREATE FUNCTION pg_temp.chk(name text, got text, want text) RETURNS text LANGUAGE sql AS $f$
 SELECT rpad(CASE WHEN got ~ want THEN 'PASS' ELSE 'FAIL' END, 6) || rpad(name, greatest(76, length(name) + 1)) || got
$f$;
\set U  '''00000000-0000-4000-8000-0000000000a0'''
\set P1 '''00000000-0000-4000-8000-0000000000a1'''
\set P2 '''00000000-0000-4000-8000-0000000000a2'''
\set APPT '''00000000-0000-4000-8000-0000000000b0'''
\set REQ '''00000000-0000-4000-8000-0000000000c0'''
\set E1 '''00000000-0000-4000-8000-0000000000d1'''
\set E2 '''00000000-0000-4000-8000-0000000000d2'''
\set E3 '''00000000-0000-4000-8000-0000000000d3'''
\set E4 '''00000000-0000-4000-8000-0000000000d4'''

\echo ===== S. structure and privileges (as installed)
SELECT pg_temp.chk('S1 eoc_iam tables, all FORCE RLS (expect 6 true)',
  (SELECT count(*) || ' ' || bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
    WHERE relnamespace = 'eoc_iam'::regnamespace AND relkind = 'r'), '^6 true$');
SELECT pg_temp.chk('S2 PUBLIC/anon/authenticated/service_role privileges in eoc_iam (expect 0)',
  (SELECT count(*)::text FROM (
     SELECT a.grantee FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace = 'eoc_iam'::regnamespace
     UNION ALL SELECT a.grantee FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.pronamespace = 'eoc_iam'::regnamespace
     UNION ALL SELECT a.grantee FROM pg_namespace s, aclexplode(s.nspacl) a WHERE s.nspname = 'eoc_iam') x
   WHERE x.grantee = 0 OR pg_get_userbyid(x.grantee) IN ('anon','authenticated','service_role')), '^0$');
SELECT pg_temp.chk('S3 function owners (expect 9 executor, 1 grant fn owner)',
  (SELECT string_agg(o || '=' || n, ' ' ORDER BY o) FROM (SELECT pg_get_userbyid(proowner) o, count(*) n FROM pg_proc
    WHERE pronamespace = 'eoc_iam'::regnamespace GROUP BY 1) z), '^eoc_grant_fn_owner=1 eoc_iam_executor=9$');
SELECT pg_temp.chk('S4 postgres keeps no USAGE/SET on the EOC roles (expect 0)',
  (SELECT count(*)::text FROM unnest(ARRAY['eoc_app_runtime','eoc_iam_executor','eoc_grant_admin_runtime','eoc_grant_fn_owner',
     'eoc_iam_verified_attestation_writer']) r WHERE pg_has_role('postgres', r, 'USAGE') OR pg_has_role('postgres', r, 'SET')), '^0$');

-- test-only: let postgres SET ROLE to the three callers (rolled back with the transaction)
GRANT eoc_app_runtime, eoc_grant_admin_runtime, eoc_iam_verified_attestation_writer TO postgres WITH INHERIT FALSE, SET TRUE;

\echo ===== A. EOC app runtime (the role the EOC backend logs in as)
SELECT pg_temp.chk('A1 direct SELECT on sessions = Anthony BFF ready query (expect permission denied)',
  pg_temp.as_role('eoc_app_runtime', 'SELECT 1 FROM eoc_iam.sessions LIMIT 1'), 'permission denied');
SELECT pg_temp.chk('A2 db_ready_v12() replacement probe (expect true)',
  pg_temp.as_role('eoc_app_runtime', 'SELECT eoc_iam.db_ready_v12()::text'), '^true$');
SELECT pg_temp.chk('A3 create_flow_v12 (expect empty = ok)',
  pg_temp.as_role('eoc_app_runtime', $q$SELECT eoc_iam.create_flow_v12(repeat('3',64), repeat('v',50), repeat('s',20), repeat('n',20))::text$q$), '^$');
SELECT pg_temp.chk('A4 consume_flow_v12 (expect the flow)',
  pg_temp.as_role('eoc_app_runtime', $q$SELECT f.flow_hash FROM eoc_iam.consume_flow_v12(repeat('3',64)) f$q$), '^3{64}$');
SELECT pg_temp.chk('A5 consume the same flow again (expect NULL, single use)',
  pg_temp.as_role('eoc_app_runtime', $q$SELECT f.flow_hash FROM eoc_iam.consume_flow_v12(repeat('3',64)) f$q$), '^NULL$');
SELECT pg_temp.as_role('eoc_app_runtime', $q$SELECT eoc_iam.create_flow_v12(repeat('4',64), repeat('v',50), repeat('t',20), repeat('m',20))::text$q$) \g /dev/null
UPDATE eoc_iam.login_flows SET created_at = clock_timestamp() - interval '10 minutes', expires_at = clock_timestamp() - interval '5 minutes'
 WHERE flow_hash = repeat('4',64);
SELECT pg_temp.chk('A6 expired flow (expect NULL)',
  pg_temp.as_role('eoc_app_runtime', $q$SELECT f.flow_hash FROM eoc_iam.consume_flow_v12(repeat('4',64)) f$q$), '^NULL$');
SELECT pg_temp.chk('A7 bad flow input (expect INVALID_FLOW)',
  pg_temp.as_role('eoc_app_runtime', $q$SELECT eoc_iam.create_flow_v12(repeat('5',64), 'short', repeat('s',20), repeat('n',20))::text$q$), 'INVALID_FLOW');
SELECT pg_temp.chk('A8 create_session_and_audit_v12 (expect session uuid)',
  pg_temp.as_role('eoc_app_runtime', format($q$SELECT eoc_iam.create_session_and_audit_v12(repeat('1',64), repeat('2',64), %L, 'CEO', %L, 'CEO',
    1, 1, 0, ARRAY['hwk'], clock_timestamp(), %L)::text$q$, :U, :APPT, :REQ)), '^[0-9a-f-]{36}$');
SELECT session_id AS sid FROM eoc_iam.sessions WHERE token_hash = repeat('1',64) \gset
SELECT pg_temp.chk('A9 session_by_hash_v12 (expect the test subject)',
  pg_temp.as_role('eoc_app_runtime', $q$SELECT s.subject_id::text FROM eoc_iam.session_by_hash_v12(repeat('1',64)) s$q$), :U);
SELECT pg_temp.chk('A10 LOGIN_SUCCESS audit written in the same call (expect 1)',
  (SELECT count(*)::text FROM eoc_iam.audit_events WHERE request_id = :REQ::uuid AND event_type = 'LOGIN_SUCCESS'), '^1$');
SELECT pg_temp.chk('A11 touch_session_v12 (expect true)',
  pg_temp.as_role('eoc_app_runtime', format('SELECT (eoc_iam.touch_session_v12(%L) IS NOT NULL)::text', :'sid')), '^true$');
SELECT pg_temp.chk('A12 revoke_session_v12 (expect true)',
  pg_temp.as_role('eoc_app_runtime', format('SELECT eoc_iam.revoke_session_v12(%L)::text', :'sid')), '^true$');
SELECT pg_temp.chk('A13 revoked session no longer found (expect NULL)',
  pg_temp.as_role('eoc_app_runtime', $q$SELECT s.subject_id::text FROM eoc_iam.session_by_hash_v12(repeat('1',64)) s$q$), '^NULL$');
SELECT pg_temp.chk('A14 revoke again (expect false)',
  pg_temp.as_role('eoc_app_runtime', format('SELECT eoc_iam.revoke_session_v12(%L)::text', :'sid')), '^false$');
SELECT pg_temp.chk('A15 negative epoch (expect INVALID_SESSION)',
  pg_temp.as_role('eoc_app_runtime', format($q$SELECT eoc_iam.create_session_and_audit_v12(repeat('6',64), repeat('7',64), %L, 'CEO', %L, 'CEO',
    1, 1, -1, ARRAY['hwk'], clock_timestamp(), %L)::text$q$, :U, :APPT, :REQ)), 'INVALID_SESSION');
SELECT pg_temp.chk('A16 audit_event_v12 LOGOUT (expect empty = ok)',
  pg_temp.as_role('eoc_app_runtime', format($q$SELECT eoc_iam.audit_event_v12('LOGOUT', %L, NULL, %L, 'LOCAL_SESSION')::text$q$, :U, :REQ)), '^$');
SELECT pg_temp.chk('A17 audit_event_v12 forged GRANT_CREATED (expect AUDIT_INVALID)',
  pg_temp.as_role('eoc_app_runtime', format($q$SELECT eoc_iam.audit_event_v12('GRANT_CREATED', %L, NULL, %L, 'x')::text$q$, :U, :REQ)), 'AUDIT_INVALID');
SELECT pg_temp.chk('A18 app runtime calls create_governed_grant_v12 (expect permission denied)',
  pg_temp.as_role('eoc_app_runtime', format($q$SELECT eoc_iam.create_governed_grant_v12(%L,'executive','VIEW','ENTERPRISE','{}'::text[],%L,%L,%L,%L,
    clock_timestamp(),clock_timestamp()+interval '30 days',%L,'IAM_ATTESTED:c1:c2')::text$q$, :U, :P1, :P2, :E1, :E2, :REQ)), 'permission denied');
SELECT pg_temp.chk('A19 app runtime UPDATE sessions directly (expect permission denied)',
  pg_temp.as_role('eoc_app_runtime', 'UPDATE eoc_iam.sessions SET revoked_at = NULL'), 'permission denied');

\echo ===== G. governed grants (two independent verified approvals)
\set GRANT_CALL 'SELECT eoc_iam.create_governed_grant_v12(%L,%L,''VIEW'',''ENTERPRISE'',''{}''::text[],%L,%L,%L,%L,clock_timestamp(),clock_timestamp()+interval ''30 days'',%L,''IAM_ATTESTED:c1:c2'')::text'
\set ATTEST 'INSERT INTO eoc_iam.grant_verified_attestations_v12(evidence_id,approver_user_id,target_user_id,request_id,module_id,operation,scope_kind,scope_ids,purpose,verified_at,expires_at,verifier_reference) VALUES (%L,%L,%L,%L,%L,''VIEW'',''ENTERPRISE'',''{}'',''EOC_MODULE_GRANT_APPROVE'',clock_timestamp()-%L::interval,clock_timestamp()+%L::interval,''STAGING-SYNTHETIC-VERIFIER-REF'')'
SELECT pg_temp.chk('G1 grant with no verified approvals (expect VERIFIED_WEB_AUTHN_ADMISSIONS_REQUIRED)',
  pg_temp.as_role('eoc_grant_admin_runtime', format(:'GRANT_CALL', :U, 'executive', :P1, :P2, :E1, :E2, :REQ)), 'VERIFIED_WEB_AUTHN_ADMISSIONS_REQUIRED');
SELECT pg_temp.chk('G2 attestation writer inserts approval 1 (expect OK)',
  pg_temp.as_role('eoc_iam_verified_attestation_writer', format(:'ATTEST', :E1, :P1, :U, :REQ, 'executive', '0 s', '4 minutes')), '^OK$');
SELECT pg_temp.chk('G3 attestation writer inserts approval 2 (expect OK)',
  pg_temp.as_role('eoc_iam_verified_attestation_writer', format(:'ATTEST', :E2, :P2, :U, :REQ, 'executive', '0 s', '4 minutes')), '^OK$');
SELECT pg_temp.chk('G4 attestation writer reads attestations (expect permission denied)',
  pg_temp.as_role('eoc_iam_verified_attestation_writer', 'SELECT count(*)::text FROM eoc_iam.grant_verified_attestations_v12'), 'permission denied');
SELECT pg_temp.chk('G5 expired attestation (expect row-level security refusal)',
  pg_temp.as_role('eoc_iam_verified_attestation_writer', format(:'ATTEST', :E3, :P1, :U, :REQ, 'executive', '10 minutes', '-6 minutes')), 'row-level security');
SELECT pg_temp.chk('G6 same approver twice (expect GRANT_APPROVAL_INVALID)',
  pg_temp.as_role('eoc_grant_admin_runtime', format(:'GRANT_CALL', :U, 'executive', :P1, :P1, :E1, :E2, :REQ)), 'GRANT_APPROVAL_INVALID');
SELECT pg_temp.chk('G7 approvals for another module (expect VERIFIED_WEB_AUTHN_ADMISSIONS_REQUIRED)',
  pg_temp.as_role('eoc_grant_admin_runtime', format(:'GRANT_CALL', :U, 'capital', :P1, :P2, :E1, :E2, :REQ)), 'VERIFIED_WEB_AUTHN_ADMISSIONS_REQUIRED');
SELECT pg_temp.chk('G8 grant with both approvals (expect grant uuid)',
  pg_temp.as_role('eoc_grant_admin_runtime', format(:'GRANT_CALL', :U, 'executive', :P1, :P2, :E1, :E2, :REQ)), '^[0-9a-f-]{36}$');
SELECT pg_temp.chk('G9 replay the same approvals (expect VERIFIED_WEB_AUTHN_ADMISSIONS_REQUIRED)',
  pg_temp.as_role('eoc_grant_admin_runtime', format(:'GRANT_CALL', :U, 'executive', :P1, :P2, :E1, :E2, :REQ)), 'VERIFIED_WEB_AUTHN_ADMISSIONS_REQUIRED');
SELECT pg_temp.chk('G10 app runtime sees the grant via grants_for_subject_v12 (expect 1)',
  pg_temp.as_role('eoc_app_runtime', format('SELECT count(*)::text FROM eoc_iam.grants_for_subject_v12(%L)', :U)), '^1$');
SELECT pg_temp.chk('G11 grant admin inserts module_grants directly (expect permission denied)',
  pg_temp.as_role('eoc_grant_admin_runtime', format($q$INSERT INTO eoc_iam.module_grants(subject_id,module_id,operation,scope_kind,approved_by,secondary_approved_by,approved_at,approval_reference,valid_from,valid_until)
    VALUES (%L,'executive','VIEW','ENTERPRISE',%L,%L,clock_timestamp(),'forged',clock_timestamp(),clock_timestamp()+interval '1 day')$q$, :U, :P1, :P2)), 'permission denied');
SELECT pg_temp.chk('G12 grant admin inserts its own attestation (expect permission denied)',
  pg_temp.as_role('eoc_grant_admin_runtime', format(:'ATTEST', :E4, :P1, :U, :REQ, 'executive', '0 s', '4 minutes')), 'permission denied');
SELECT pg_temp.chk('G13 GRANT_CREATED audit + 2 consumed approvals (expect 1 2)',
  (SELECT (SELECT count(*) FROM eoc_iam.audit_events WHERE event_type = 'GRANT_CREATED' AND request_id = :REQ::uuid) || ' ' ||
          (SELECT count(*) FROM eoc_iam.grant_approval_consumptions_v12 WHERE evidence_id IN (:E1::uuid, :E2::uuid))), '^1 2$');
\echo EOC DB TEST DONE (the caller rolls the transaction back; nothing is kept)
