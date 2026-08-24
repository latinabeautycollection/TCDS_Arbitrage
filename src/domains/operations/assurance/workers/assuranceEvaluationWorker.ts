import os from "node:os";
import { assuranceEnv } from "../config/assuranceEnv";
import {
  claimAssuranceRuns,
  scheduleDueAssuranceRuns
} from "../repositories/assuranceRunRepository";
import { processAssuranceRun } from "../services/assuranceEvaluationService";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";

const workerId=`${os.hostname()}:${process.pid}:10E-assurance-evaluator`;

export async function runAssuranceEvaluationBatch():Promise<number>{
  const env=assuranceEnv();
  if(!env.DOMAIN10_ASSURANCE_ENABLED) return 0;

  const runtime=domain10Runtime();
  const scheduled=await scheduleDueAssuranceRuns();
  if(scheduled>0){
    runtime.metrics.gauge("domain10_assurance_runs_scheduled_last_batch",scheduled);
  }

  const runs=await claimAssuranceRuns(
    workerId,
    env.DOMAIN10_ASSURANCE_EVALUATION_BATCH_SIZE,
    env.DOMAIN10_ASSURANCE_EVALUATION_LEASE_SECONDS
  );

  let processed=0;
  for(const run of runs){
    try{
      await processAssuranceRun(run.runId,workerId);
    }catch(error){
      runtime.logger.error("Domain 10 assurance evaluation failed",{
        runId:run.runId,
        policyKey:run.policyKey,
        metricKey:run.metricKey,
        errorName:error instanceof Error?error.name:"UnknownError"
      });
    }finally{
      processed++;
    }
  }
  return processed;
}
