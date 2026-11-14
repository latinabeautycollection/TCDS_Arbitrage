-- Tests for 624 + 625 as installed (inside the caller's transaction; the caller rolls back). One PASS/FAIL line each.
-- Postgres temporarily joins each V1.3 role (it created them, so it holds ADMIN) to act as that role.
CREATE TEMP TABLE v13_r (n serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.ck(p_name text, p_got text, p_re text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO v13_r (line) VALUES (format('%-5s %-78s %s', CASE WHEN coalesce(p_got, '<null>') ~ p_re THEN 'PASS' ELSE 'FAIL' END,
                                          p_name, left(coalesce(p_got, '<null>'), 90))) $$;
CREATE FUNCTION pg_temp.as_role(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR: ' || SQLERRM;
END $$;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['tcds_eoc_attestation_writer', 'tcds_eoc_binding_admin', 'tcds_eoc_audit_retention_worker',
                           'tcds_eoc_legal_hold_admin'] LOOP
    EXECUTE format('GRANT %I TO postgres WITH INHERIT FALSE, SET TRUE', r);
  END LOOP;
END $$;

-- S. structure
SELECT pg_temp.ck('S1 webauthn_verification_evidence columns 624 needs (expect 4)',
  (SELECT count(*)::text FROM pg_attribute WHERE attrelid = 'warehouse_identity.webauthn_verification_evidence'::regclass
     AND attname IN ('webauthn_verification_evidence_id', 'user_id', 'user_verified', 'verified_at') AND NOT attisdropped), '^4$');
SELECT pg_temp.ck('S2 approver capability role row exists, assigned to nobody (expect 1 0)',
  (SELECT count(*) || ' ' || (SELECT count(*) FROM warehouse_identity.user_role_assignments ura WHERE ura.role_id = r.role_id)
     FROM warehouse_identity.roles r WHERE r.role_code = 'EOC_IDENTITY_BINDING_APPROVER' GROUP BY r.role_id), '^1 0$');
SELECT pg_temp.ck('S3 tcds_login_api (bridge runtime) cannot execute either V1.3 function (expect f f)',
  has_function_privilege('tcds_login_api', 'warehouse_identity.eoc_create_binding_v13(uuid,uuid,text,text,uuid,uuid,uuid)', 'EXECUTE')::text
  || ' ' || has_function_privilege('tcds_login_api', 'warehouse_identity.eoc_bridge_retention_batch_v13(integer)', 'EXECUTE')::text, '^false false$');
SELECT pg_temp.ck('S4 623 bridge functions still callable by tcds_login_api (expect true)',
  has_function_privilege('tcds_login_api', 'warehouse_identity.eoc_resolve_federation_v623(text,text,uuid)', 'EXECUTE')::text, '^true$');

-- B. binding writer (624)
SELECT pg_temp.ck('B1 binding admin: invalid input (expect BINDING_APPROVAL_INVALID)',
  pg_temp.as_role('tcds_eoc_binding_admin', $q$SELECT warehouse_identity.eoc_create_binding_v13(gen_random_uuid(), gen_random_uuid(),
    'http://not-https', repeat('a', 64), gen_random_uuid(), gen_random_uuid(), gen_random_uuid())::text$q$), 'BINDING_APPROVAL_INVALID');
SELECT pg_temp.ck('B2 binding admin: same approver twice (expect BINDING_APPROVAL_INVALID)',
  pg_temp.as_role('tcds_eoc_binding_admin', $q$SELECT warehouse_identity.eoc_create_binding_v13(gen_random_uuid(), gen_random_uuid(),
    'https://login-stg.tcdsolutionsgroup.com', repeat('a', 64), gen_random_uuid(),
    '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001')::text$q$), 'BINDING_APPROVAL_INVALID');
SELECT pg_temp.ck('B3 binding admin: well-formed but no attestations (expect BINDING_APPROVER_REVOKED_OR_UNVERIFIED)',
  pg_temp.as_role('tcds_eoc_binding_admin', $q$SELECT warehouse_identity.eoc_create_binding_v13(gen_random_uuid(), gen_random_uuid(),
    'https://login-stg.tcdsolutionsgroup.com', repeat('a', 64), gen_random_uuid(), gen_random_uuid(), gen_random_uuid())::text$q$),
  'BINDING_APPROVER_REVOKED_OR_UNVERIFIED');
SELECT pg_temp.ck('B4 binding admin cannot write bindings directly (expect permission denied)',
  pg_temp.as_role('tcds_eoc_binding_admin', $q$INSERT INTO warehouse_identity.eoc_federated_subject_bindings_v12 (issuer, subject_hash, user_id)
    VALUES ('https://x', repeat('a', 64), gen_random_uuid()) RETURNING 'inserted'$q$), 'permission denied');
SELECT pg_temp.ck('B5 attestation writer cannot read approvals (expect permission denied)',
  pg_temp.as_role('tcds_eoc_attestation_writer', 'SELECT count(*)::text FROM warehouse_identity.eoc_binding_approvals_v13'), 'permission denied');
SELECT pg_temp.ck('B6 attestation writer cannot call the binding writer (expect permission denied)',
  pg_temp.as_role('tcds_eoc_attestation_writer', $q$SELECT warehouse_identity.eoc_create_binding_v13(gen_random_uuid(), gen_random_uuid(),
    'https://x', repeat('a', 64), gen_random_uuid(), gen_random_uuid(), gen_random_uuid())::text$q$), 'permission denied');
SELECT pg_temp.ck('B7 attestation with 10-minute validity is rejected by CHECK (expect check constraint)',
  pg_temp.as_role('tcds_eoc_attestation_writer', $q$INSERT INTO warehouse_identity.eoc_binding_approvals_v13 (evidence_id, request_id,
    binding_id, approver_user_id, auth_session_id, web_authn_evidence_id, target_user_id, oidc_issuer, subject_hash, verified_at,
    expires_at, verifier_digest, ceremony_id) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'https://x', repeat('a', 64), clock_timestamp(),
    clock_timestamp() + interval '10 minutes', repeat('b', 64), gen_random_uuid()) RETURNING 'inserted'$q$), 'check constraint|violates');

-- R. retention (625)
SELECT pg_temp.ck('R1 retention without storage certification (expect ARCHIVE_STORAGE_CERTIFICATION_REQUIRED)',
  pg_temp.as_role('tcds_eoc_audit_retention_worker', 'SELECT row(r.*)::text FROM warehouse_identity.eoc_bridge_retention_batch_v13(500) r'),
  'ARCHIVE_STORAGE_CERTIFICATION_REQUIRED');
SELECT pg_temp.ck('R2 retention batch limit 0 (expect RETENTION_BATCH_LIMIT_INVALID)',
  pg_temp.as_role('tcds_eoc_audit_retention_worker', 'SELECT row(r.*)::text FROM warehouse_identity.eoc_bridge_retention_batch_v13(0) r'),
  'RETENTION_BATCH_LIMIT_INVALID');
SELECT set_config('tcds.eoc_archive_storage_certified', 'YES', true);
SELECT pg_temp.ck('R3 certified run: nothing older than 90 days yet (expect (0,0,0))',
  pg_temp.as_role('tcds_eoc_audit_retention_worker', 'SELECT row(r.*)::text FROM warehouse_identity.eoc_bridge_retention_batch_v13(500) r'),
  '^\(0,0,0\)$');
SELECT set_config('tcds.eoc_archive_storage_certified', '', true);
SELECT pg_temp.ck('R4 the run was recorded (expect 1; skipped if postgres cannot bypass the forced RLS)',
  (SELECT CASE WHEN (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)
               THEN (SELECT count(*)::text FROM warehouse_identity.eoc_bridge_retention_runs_v13)
               ELSE 'skipped (forced RLS)' END), '^(1|skipped.*)$');
SELECT pg_temp.ck('R5 retention worker cannot read the hot audit directly (expect permission denied)',
  pg_temp.as_role('tcds_eoc_audit_retention_worker', 'SELECT count(*)::text FROM warehouse_identity.eoc_bridge_audit_v12'), 'permission denied');
SELECT pg_temp.ck('R6 legal-hold admin places a hold (expect inserted)',
  pg_temp.as_role('tcds_eoc_legal_hold_admin', $q$INSERT INTO warehouse_identity.eoc_bridge_legal_holds_v13 (subject_id, reason_reference,
    approved_by) VALUES (gen_random_uuid(), 'TEST-LEGAL-HOLD-0001', gen_random_uuid()) RETURNING 'inserted'$q$), '^inserted$');
SELECT pg_temp.ck('R7 legal-hold admin cannot delete holds (expect permission denied)',
  pg_temp.as_role('tcds_eoc_legal_hold_admin', $q$DELETE FROM warehouse_identity.eoc_bridge_legal_holds_v13 RETURNING 'deleted'$q$), 'permission denied');
SELECT pg_temp.ck('R8 legal-hold admin cannot run retention (expect permission denied)',
  pg_temp.as_role('tcds_eoc_legal_hold_admin', 'SELECT row(r.*)::text FROM warehouse_identity.eoc_bridge_retention_batch_v13(10) r'), 'permission denied');

SELECT line FROM v13_r ORDER BY n;
