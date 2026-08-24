import { domain10Runtime } from "../../infrastructure/operationsRuntime";
import type {
  AssuranceEvaluationResult,
  ClaimedAssuranceRun
} from "../models/assuranceTypes";

export async function scheduleDueAssuranceRuns():Promise<number>{
  const r=await domain10Runtime().pool.query<{scheduled_count:number}>(`
    SELECT operations.schedule_due_assurance_runs_10e(clock_timestamp()) AS scheduled_count
  `);
  return Number(r.rows[0]?.scheduled_count??0);
}

export async function claimAssuranceRuns(
  workerId:string,
  batchSize:number,
  leaseSeconds:number
):Promise<ClaimedAssuranceRun[]>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT run_id,policy_id,policy_version,policy_key,metric_key,
           window_start,window_end,attempt_count
    FROM operations.claim_assurance_runs_10e($1,$2,$3)
  `,[workerId,batchSize,leaseSeconds]);

  return r.rows.map((x:any)=>({
    runId:x.run_id,
    policyId:x.policy_id,
    policyVersion:x.policy_version,
    policyKey:x.policy_key,
    metricKey:x.metric_key,
    windowStart:new Date(x.window_start).toISOString(),
    windowEnd:new Date(x.window_end).toISOString(),
    attemptCount:x.attempt_count
  }));
}

export async function evaluateAssuranceRun(
  runId:string,
  workerId:string
):Promise<AssuranceEvaluationResult>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT run_id,outcome,metric_value,threshold_value,comparison,sample_size,unit
    FROM operations.evaluate_assurance_run_10e($1,$2)
  `,[runId,workerId]);

  const x=r.rows[0];
  if(!x) throw new Error("evaluate_assurance_run_10e returned no row");

  return {
    runId:x.run_id,
    outcome:x.outcome,
    ...(x.metric_value===null?{}:{metricValue:Number(x.metric_value)}),
    thresholdValue:Number(x.threshold_value),
    comparison:x.comparison,
    sampleSize:Number(x.sample_size),
    unit:x.unit
  };
}

export async function failAssuranceRun(
  runId:string,
  workerId:string,
  errorCode:string,
  errorMessage:string
):Promise<void>{
  await domain10Runtime().pool.query(`
    SELECT operations.fail_assurance_run_10e($1,$2,$3,$4)
  `,[runId,workerId,errorCode,errorMessage.slice(0,1000)]);
}
