BEGIN;

CREATE OR REPLACE FUNCTION operations.guard_domain10_certification_run_10f()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION '10F certification runs cannot be deleted'; END IF;
  IF ROW(NEW.profile_id,NEW.profile_version,NEW.profile_key,NEW.release_key,NEW.git_commit_sha,
         NEW.environment,NEW.window_start,NEW.window_end,NEW.requested_by,NEW.request_id,
         NEW.schema_fingerprint,NEW.input_hash,NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.profile_id,OLD.profile_version,OLD.profile_key,OLD.release_key,OLD.git_commit_sha,
         OLD.environment,OLD.window_start,OLD.window_end,OLD.requested_by,OLD.request_id,
         OLD.schema_fingerprint,OLD.input_hash,OLD.created_at) THEN
    RAISE EXCEPTION '10F certification run identity is immutable';
  END IF;
  IF OLD.state IN('CERTIFIED','REJECTED','ERROR') THEN
    RAISE EXCEPTION 'Terminal 10F certification run is immutable';
  END IF;
  IF NEW.state<>OLD.state AND NOT(
    (OLD.state='CREATED' AND NEW.state='RUNNING') OR
    (OLD.state='RUNNING' AND NEW.state IN('AWAITING_ATTESTATIONS','REJECTED','ERROR')) OR
    (OLD.state='AWAITING_ATTESTATIONS' AND NEW.state IN('CERTIFIED','REJECTED','ERROR'))
  ) THEN RAISE EXCEPTION 'Invalid 10F certification state transition % -> %',OLD.state,NEW.state; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_domain10_certification_run_10f
BEFORE UPDATE OR DELETE ON operations.domain10_certification_runs_10f
FOR EACH ROW EXECUTE FUNCTION operations.guard_domain10_certification_run_10f();

CREATE OR REPLACE FUNCTION operations.deny_domain10_certification_evidence_mutation_10f()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '10F certification evidence is append-only'; END $$;
CREATE TRIGGER trg_certification_check_results_immutable_10f
BEFORE UPDATE OR DELETE ON operations.domain10_certification_check_results_10f
FOR EACH ROW EXECUTE FUNCTION operations.deny_domain10_certification_evidence_mutation_10f();
CREATE TRIGGER trg_certification_attestations_immutable_10f
BEFORE UPDATE OR DELETE ON operations.domain10_certification_attestations_10f
FOR EACH ROW EXECUTE FUNCTION operations.deny_domain10_certification_evidence_mutation_10f();

-- Validate evidence hashes at insert; callers cannot claim arbitrary hashes.
CREATE OR REPLACE FUNCTION operations.verify_domain10_certification_evidence_hash_10f()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text;
BEGIN
  IF TG_TABLE_NAME='domain10_certification_check_results_10f' THEN
    expected:=encode(extensions.digest(NEW.check_key||'|'||NEW.outcome||'|'||NEW.sample_size::text||'|'||NEW.failure_count::text||'|'||NEW.details::text,'sha256'),'hex');
    IF NEW.result_hash<>expected THEN RAISE EXCEPTION '10F check result hash mismatch'; END IF;
  ELSE
    expected:=encode(extensions.digest(NEW.run_id::text||'|'||NEW.attestation_type||'|'||NEW.outcome||'|'||NEW.evidence_sha256||'|'||
      NEW.evidence_reference||'|'||NEW.attested_by||'|'||coalesce(NEW.tool_version,'')||'|'||coalesce(NEW.notes,''),'sha256'),'hex');
    IF NEW.attestation_hash<>expected THEN RAISE EXCEPTION '10F attestation hash mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_verify_certification_check_hash_10f
BEFORE INSERT ON operations.domain10_certification_check_results_10f
FOR EACH ROW EXECUTE FUNCTION operations.verify_domain10_certification_evidence_hash_10f();
CREATE TRIGGER trg_verify_certification_attestation_hash_10f
BEFORE INSERT ON operations.domain10_certification_attestations_10f
FOR EACH ROW EXECUTE FUNCTION operations.verify_domain10_certification_evidence_hash_10f();

COMMIT;
