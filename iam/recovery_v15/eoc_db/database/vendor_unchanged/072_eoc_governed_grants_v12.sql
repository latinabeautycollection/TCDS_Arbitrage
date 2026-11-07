-- EOC RETAIL DATABASE ONLY, after 071; this creates no credential or WebAuthn verifier.
-- The separate grant-admin process MUST verify signed, current, purpose-bound IAM approval evidence.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$BEGIN IF to_regclass('eoc_iam.module_grants') IS NULL THEN RAISE EXCEPTION 'EOC_GRANTS_DEPENDENCY_MISSING'; END IF; END$$;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='eoc_grant_admin_runtime') THEN CREATE ROLE eoc_grant_admin_runtime NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='eoc_grant_fn_owner') THEN CREATE ROLE eoc_grant_fn_owner NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='eoc_iam_verified_attestation_writer') THEN CREATE ROLE eoc_iam_verified_attestation_writer NOLOGIN; END IF;
END$$;
-- This table is populated ONLY by an independently authenticated IAM verifier admission service,
-- not by the retail EOC application or the grant-admin client.
CREATE TABLE eoc_iam.grant_verified_attestations_v12 (
 evidence_id uuid PRIMARY KEY, approver_user_id uuid NOT NULL, target_user_id uuid NOT NULL,
 request_id uuid NOT NULL, module_id text NOT NULL, operation text NOT NULL,
 scope_kind text NOT NULL,scope_ids text[] NOT NULL,
 purpose text NOT NULL CHECK(purpose='EOC_MODULE_GRANT_APPROVE'),
 verified_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 verifier_reference text NOT NULL CHECK(length(verifier_reference)>=16),
 consumed_at timestamptz,
 CHECK(expires_at>verified_at AND expires_at<=verified_at+interval '5 minutes')
);
ALTER TABLE eoc_iam.grant_verified_attestations_v12 ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoc_iam.grant_verified_attestations_v12 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON eoc_iam.grant_verified_attestations_v12 FROM PUBLIC;
GRANT USAGE ON SCHEMA eoc_iam TO eoc_iam_verified_attestation_writer;
GRANT INSERT ON eoc_iam.grant_verified_attestations_v12 TO eoc_iam_verified_attestation_writer;
CREATE POLICY eoc_iam_verified_attestation_insert ON eoc_iam.grant_verified_attestations_v12 FOR INSERT TO eoc_iam_verified_attestation_writer WITH CHECK(consumed_at IS NULL AND expires_at>clock_timestamp() AND verified_at<=clock_timestamp());
CREATE TABLE eoc_iam.grant_approval_consumptions_v12 (
 evidence_id uuid PRIMARY KEY, grant_id uuid NOT NULL REFERENCES eoc_iam.module_grants(grant_id),
 approved_by uuid NOT NULL, consumed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE eoc_iam.grant_approval_consumptions_v12 ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoc_iam.grant_approval_consumptions_v12 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON eoc_iam.grant_approval_consumptions_v12 FROM PUBLIC;
GRANT USAGE ON SCHEMA eoc_iam TO eoc_grant_fn_owner,eoc_grant_admin_runtime;
GRANT CREATE ON SCHEMA eoc_iam TO eoc_grant_fn_owner;
GRANT SELECT,INSERT,UPDATE ON eoc_iam.module_grants TO eoc_grant_fn_owner;
GRANT INSERT ON eoc_iam.grant_approval_consumptions_v12,eoc_iam.audit_events TO eoc_grant_fn_owner;
GRANT SELECT,UPDATE(consumed_at) ON eoc_iam.grant_verified_attestations_v12 TO eoc_grant_fn_owner;
GRANT USAGE ON SEQUENCE eoc_iam.audit_events_audit_id_seq TO eoc_grant_fn_owner;
CREATE POLICY eoc_governed_grant_mutation ON eoc_iam.module_grants FOR ALL TO eoc_grant_fn_owner USING(true) WITH CHECK(true);
CREATE POLICY eoc_governed_attestation_read ON eoc_iam.grant_verified_attestations_v12 FOR SELECT TO eoc_grant_fn_owner USING(true);
CREATE POLICY eoc_governed_attestation_consume ON eoc_iam.grant_verified_attestations_v12 FOR UPDATE TO eoc_grant_fn_owner USING(true) WITH CHECK(true);
CREATE POLICY eoc_governed_grant_evidence ON eoc_iam.grant_approval_consumptions_v12 FOR INSERT TO eoc_grant_fn_owner WITH CHECK(true);
CREATE POLICY eoc_governed_grant_audit ON eoc_iam.audit_events FOR INSERT TO eoc_grant_fn_owner WITH CHECK(true);
CREATE FUNCTION eoc_iam.create_governed_grant_v12(
 p_user uuid,p_module text,p_operation text,p_scope text,p_scope_ids text[],p_first uuid,p_second uuid,p_evidence_first uuid,p_evidence_second uuid,
 p_from timestamptz,p_until timestamptz,p_request uuid,p_reference text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_grant uuid:=gen_random_uuid(); v_count integer;
BEGIN
 IF p_user IS NULL OR p_first IS NULL OR p_second IS NULL OR p_first=p_second OR p_user=p_first OR p_user=p_second OR p_evidence_first IS NULL OR p_evidence_second IS NULL OR p_evidence_first=p_evidence_second OR p_request IS NULL OR p_until<=clock_timestamp() OR p_until<=p_from OR p_until>clock_timestamp()+interval '366 days' OR p_reference NOT LIKE 'IAM_ATTESTED:%' THEN
  RAISE EXCEPTION 'GRANT_APPROVAL_INVALID' USING ERRCODE='42501';
 END IF;
 -- Select both signed-verifier admissions and lock in stable order to exclude concurrent reuse.
 -- Neither the normal EOC runtime nor the grant-admin DB role can insert verifier evidence.
 PERFORM 1 FROM eoc_iam.grant_verified_attestations_v12 a
  WHERE a.evidence_id IN (p_evidence_first,p_evidence_second)
  ORDER BY a.evidence_id FOR UPDATE;
 SELECT count(*) INTO v_count FROM eoc_iam.grant_verified_attestations_v12 a
 WHERE ((a.evidence_id=p_evidence_first AND a.approver_user_id=p_first) OR (a.evidence_id=p_evidence_second AND a.approver_user_id=p_second))
   AND a.target_user_id=p_user AND a.request_id=p_request AND a.module_id=p_module AND a.operation=p_operation
   AND a.scope_kind=p_scope AND a.scope_ids=p_scope_ids AND a.purpose='EOC_MODULE_GRANT_APPROVE'
   AND a.verified_at<=clock_timestamp() AND a.expires_at>clock_timestamp() AND a.consumed_at IS NULL;
 IF v_count<>2 THEN RAISE EXCEPTION 'VERIFIED_WEB_AUTHN_ADMISSIONS_REQUIRED' USING ERRCODE='42501'; END IF;
 UPDATE eoc_iam.grant_verified_attestations_v12 SET consumed_at=clock_timestamp() WHERE evidence_id IN (p_evidence_first,p_evidence_second) AND consumed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_REPLAY' USING ERRCODE='42501'; END IF;
 INSERT INTO eoc_iam.module_grants(grant_id,subject_id,module_id,operation,scope_kind,scope_ids,approved_by,secondary_approved_by,approved_at,approval_reference,valid_from,valid_until)
 VALUES(v_grant,p_user,p_module,p_operation,p_scope,p_scope_ids,p_first,p_second,clock_timestamp(),p_reference,p_from,p_until);
 INSERT INTO eoc_iam.grant_approval_consumptions_v12(evidence_id,grant_id,approved_by) VALUES (p_evidence_first,v_grant,p_first),(p_evidence_second,v_grant,p_second);
 INSERT INTO eoc_iam.audit_events(event_type,subject_id,request_id,reason_code) VALUES('GRANT_CREATED',p_user,p_request,'TWO_INDEPENDENT_IAM_APPROVALS');
 RETURN v_grant;
END $$;
ALTER FUNCTION eoc_iam.create_governed_grant_v12(uuid,text,text,text,text[],uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text) OWNER TO eoc_grant_fn_owner;
REVOKE ALL ON FUNCTION eoc_iam.create_governed_grant_v12(uuid,text,text,text,text[],uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoc_iam.create_governed_grant_v12(uuid,text,text,text,text[],uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text) TO eoc_grant_admin_runtime;
REVOKE CREATE ON SCHEMA eoc_iam FROM eoc_grant_fn_owner;
COMMIT;
