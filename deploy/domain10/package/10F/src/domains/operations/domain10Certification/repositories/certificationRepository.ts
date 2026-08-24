import type { PoolClient } from "pg";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";
import type {
  CertificationRunSummary,
  RecordAttestationRequest,
  StartCertificationRequest
} from "../models/certificationTypes";

async function withRepeatableRead<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await domain10Runtime().pool.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const result=await fn(client);
    await client.query("COMMIT");
    return result;
  }catch(error){
    await client.query("ROLLBACK");
    throw error;
  }finally{
    client.release();
  }
}

export async function beginAndExecuteCertification(
  request:StartCertificationRequest
):Promise<string>{
  return withRepeatableRead(async(client)=>{
    const started=await client.query<{run_id:string}>(`
      SELECT operations.begin_domain10_certification_run_10f(
        $1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9::uuid,$10
      ) AS run_id
    `,[
      request.profileKey,request.profileVersion,request.releaseKey,
      request.gitCommitSha,request.environment,request.windowStart,request.windowEnd,
      request.requestedBy,request.requestId,request.notes??null
    ]);
    const runId=started.rows[0]?.run_id;
    if(!runId) throw new Error("10F begin certification returned no run ID");

    await client.query(`SELECT operations.execute_domain10_certification_run_10f($1,$2)`,[
      runId,request.requestedBy
    ]);
    return runId;
  });
}

export async function recordCertificationAttestation(
  request:RecordAttestationRequest
):Promise<void>{
  await domain10Runtime().pool.query(`
    SELECT operations.record_domain10_certification_attestation_10f(
      $1,$2,$3,$4,$5,$6,$7,$8
    )
  `,[
    request.runId,request.attestationType,request.outcome,
    request.evidenceSha256.toLowerCase(),request.evidenceReference,
    request.attestedBy,request.toolVersion??null,request.notes??null
  ]);
}

export async function finalizeCertification(runId:string,actor:string):Promise<void>{
  await domain10Runtime().pool.query(
    `SELECT operations.finalize_domain10_certification_run_10f($1,$2)`,
    [runId,actor]
  );
}

export async function getCertificationSummary(runId:string):Promise<CertificationRunSummary>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT * FROM operations.domain10_certification_summary_10f WHERE run_id=$1
  `,[runId]);
  const x=r.rows[0];
  if(!x) throw new Error(`10F certification run ${runId} not found`);
  return {
    runId:x.run_id,profileKey:x.profile_key,profileVersion:x.profile_version,
    releaseKey:x.release_key,gitCommitSha:x.git_commit_sha,environment:x.environment,
    windowStart:new Date(x.window_start).toISOString(),
    windowEnd:new Date(x.window_end).toISOString(),state:x.state,
    schemaFingerprint:x.schema_fingerprint,
    ...(x.profile_definition_hash?{profileDefinitionHash:x.profile_definition_hash}:{}),
    ...(x.security_fingerprint?{securityFingerprint:x.security_fingerprint}:{}),
    ...(x.requester_db_role?{requesterDbRole:x.requester_db_role}:{}),
    automatedPass:Number(x.automated_pass),automatedFail:Number(x.automated_fail),
    automatedInconclusive:Number(x.automated_inconclusive),
    requiredAttestations:Number(x.required_attestations),
    passedAttestations:Number(x.passed_attestations),
    failedAttestations:Number(x.failed_attestations),
    ...(x.certified_at?{certifiedAt:new Date(x.certified_at).toISOString()}:{}),
    ...(x.run_hash?{runHash:x.run_hash}:{})
  };
}
