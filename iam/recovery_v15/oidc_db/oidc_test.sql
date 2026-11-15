-- Tests for the issuer database as installed (inside the caller's transaction; the caller rolls back).
-- Adapter checks replay the exact SQL of src/pg-adapter.mjs as eoc_oidc_runtime.
CREATE TEMP TABLE oidc_r (n serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.ck(p_name text, p_got text, p_re text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO oidc_r (line) VALUES (format('%-5s %-78s %s', CASE WHEN coalesce(p_got, '<null>') ~ p_re THEN 'PASS' ELSE 'FAIL' END,
                                           p_name, left(coalesce(p_got, '<null>'), 90))) $$;
CREATE FUNCTION pg_temp.rt(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  SET LOCAL ROLE eoc_oidc_runtime;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR: ' || SQLERRM;
END $$;
GRANT eoc_oidc_runtime TO current_user WITH INHERIT FALSE, SET TRUE;

-- S. structure
SELECT pg_temp.ck('S1 eoc_oidc tables with FORCE RLS (expect 5)',
  (SELECT count(*)::text FROM pg_class WHERE relnamespace = 'eoc_oidc'::regnamespace AND relkind = 'r' AND relforcerowsecurity), '^5$');
SELECT pg_temp.ck('S2 002 applied: state column with its CHECK (expect t t)',
  (SELECT (count(*) FILTER (WHERE attname = 'state') = 1)::text FROM pg_attribute
     WHERE attrelid = 'eoc_oidc.passkey_interactions'::regclass AND NOT attisdropped) || ' ' ||
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oidc_v11_interaction_state')::text, '^true true$');
SELECT pg_temp.ck('S3 PUBLIC has no CONNECT/TEMP on database eoc_oidc (expect 0)',
  (SELECT count(*)::text FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) x
    WHERE d.datname = 'eoc_oidc' AND x.grantee = 0), '^0$');
SELECT pg_temp.ck('S4 runtime role may CONNECT to eoc_oidc (expect true)',
  has_database_privilege('eoc_oidc_runtime', 'eoc_oidc', 'CONNECT')::text, '^true$');
SELECT pg_temp.ck('S5 EOC BFF login may NOT connect to eoc_oidc (expect false, or role absent)',
  coalesce((SELECT has_database_privilege(rolname, 'eoc_oidc', 'CONNECT')::text FROM pg_roles WHERE rolname = 'eoc_iam_bff_stg'), 'absent'),
  '^(false|absent)$');
SELECT pg_temp.ck('S6 runtime role: no login/bypassrls/superuser/createrole/createdb (expect f)',
  (SELECT (rolcanlogin OR rolbypassrls OR rolsuper OR rolcreaterole OR rolcreatedb)::text FROM pg_roles WHERE rolname = 'eoc_oidc_runtime'), '^false$');

-- A. adapter (exact pg-adapter.mjs statements)
SELECT pg_temp.ck('A1 upsert AuthorizationCode (expect 1)', pg_temp.rt($q$WITH x AS (
  INSERT INTO eoc_oidc.artifacts(model,id,payload,expires_at) VALUES('AuthorizationCode','code-1','{"uid":"uid-1","grantId":"g-1"}',clock_timestamp()+interval '1 minute')
  ON CONFLICT(model,id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,consumed_at=NULL RETURNING 1) SELECT count(*)::text FROM x$q$), '^1$');
SELECT pg_temp.ck('A2 find returns the payload (expect uid-1)', pg_temp.rt($q$SELECT payload->>'uid' FROM eoc_oidc.artifacts
  WHERE model='AuthorizationCode' AND id='code-1' AND expires_at>clock_timestamp()$q$), '^uid-1$');
SELECT pg_temp.ck('A3 findByUid (expect code-1)', pg_temp.rt($q$SELECT id FROM eoc_oidc.artifacts WHERE model='AuthorizationCode'
  AND payload->>'uid'='uid-1' AND expires_at>clock_timestamp() LIMIT 1$q$), '^code-1$');
SELECT pg_temp.ck('A4 consume once (expect 1)', pg_temp.rt($q$WITH x AS (UPDATE eoc_oidc.artifacts SET consumed_at=clock_timestamp()
  WHERE model='AuthorizationCode' AND id='code-1' AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING id) SELECT count(*)::text FROM x$q$), '^1$');
SELECT pg_temp.ck('A5 consume again = code replay (expect 0, adapter throws OIDC_ALREADY_CONSUMED)', pg_temp.rt($q$WITH x AS (UPDATE eoc_oidc.artifacts
  SET consumed_at=clock_timestamp() WHERE model='AuthorizationCode' AND id='code-1' AND consumed_at IS NULL AND expires_at>clock_timestamp()
  RETURNING id) SELECT count(*)::text FROM x$q$), '^0$');
SELECT pg_temp.ck('A6 ReplayDetection first use (expect 1)', pg_temp.rt($q$WITH x AS (
  INSERT INTO eoc_oidc.artifacts(model,id,payload,expires_at) VALUES('ReplayDetection','jti-1','{}',clock_timestamp()+interval '1 minute')
  ON CONFLICT(model,id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at WHERE eoc_oidc.artifacts.expires_at<clock_timestamp()
  RETURNING 1) SELECT count(*)::text FROM x$q$), '^1$');
SELECT pg_temp.ck('A7 ReplayDetection same id while live (expect 0, adapter throws OIDC_REPLAY_DETECTED)', pg_temp.rt($q$WITH x AS (
  INSERT INTO eoc_oidc.artifacts(model,id,payload,expires_at) VALUES('ReplayDetection','jti-1','{}',clock_timestamp()+interval '1 minute')
  ON CONFLICT(model,id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at WHERE eoc_oidc.artifacts.expires_at<clock_timestamp()
  RETURNING 1) SELECT count(*)::text FROM x$q$), '^0$');
SELECT pg_temp.ck('A8 revokeByGrantId (expect 1 deleted)', pg_temp.rt($q$WITH x AS (DELETE FROM eoc_oidc.artifacts
  WHERE model='AuthorizationCode' AND payload->>'grantId'='g-1' RETURNING 1) SELECT count(*)::text FROM x$q$), '^1$');
SELECT pg_temp.ck('A9 passkey interaction defaults to CHALLENGE_ISSUED (expect it)', pg_temp.rt($q$INSERT INTO eoc_oidc.passkey_interactions
  (interaction_id,challenge_id,request_id,options,expires_at) VALUES('int-1','ch-1',gen_random_uuid(),'{}',clock_timestamp()+interval '2 minutes')
  RETURNING state$q$), '^CHALLENGE_ISSUED$');
SELECT pg_temp.ck('A10 invalid interaction state (expect check constraint)', pg_temp.rt($q$UPDATE eoc_oidc.passkey_interactions SET state='BOGUS'
  WHERE interaction_id='int-1' RETURNING state$q$), 'check constraint');
SELECT pg_temp.ck('A11 more than 5 failed attempts (expect check constraint)', pg_temp.rt($q$UPDATE eoc_oidc.passkey_interactions SET failed_attempts=6
  WHERE interaction_id='int-1' RETURNING failed_attempts::text$q$), 'check constraint');

-- E. events, retention, schema
SELECT pg_temp.ck('E1 runtime records a security event (expect inserted)', pg_temp.rt($q$INSERT INTO eoc_oidc.issuer_security_events(request_id,category)
  VALUES(gen_random_uuid(),'TEST') RETURNING 'inserted'$q$), '^inserted$');
SELECT pg_temp.ck('E2 runtime cannot read security events (expect permission denied)',
  pg_temp.rt('SELECT count(*)::text FROM eoc_oidc.issuer_security_events'), 'permission denied');
SELECT pg_temp.ck('E3 runtime cannot read legal holds (expect permission denied)',
  pg_temp.rt('SELECT count(*)::text FROM eoc_oidc.audit_legal_holds'), 'permission denied');
SELECT pg_temp.ck('E4 runtime cannot write archival receipts (expect permission denied)',
  pg_temp.rt($q$INSERT INTO eoc_oidc.audit_archival_receipts(event_id_from,event_id_through,archive_location,archive_sha256,archive_verified_at,independent_verifier)
  VALUES(1,1,'x',repeat('a',64),clock_timestamp(),'x') RETURNING 'inserted'$q$), 'permission denied');
SELECT pg_temp.ck('E5 runtime cannot create objects in eoc_oidc (expect permission denied)',
  pg_temp.rt('CREATE TABLE eoc_oidc.x(i int)'), 'permission denied');
SELECT pg_temp.ck('E6 runtime cannot create objects in public (expect permission denied)',
  pg_temp.rt('CREATE TABLE public.x(i int)'), 'permission denied');

SELECT line FROM oidc_r ORDER BY n;
