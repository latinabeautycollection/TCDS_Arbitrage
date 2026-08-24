import {
  evaluateAssuranceRun,
  failAssuranceRun
} from "../repositories/assuranceRunRepository";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";

export async function processAssuranceRun(
  runId:string,
  workerId:string
):Promise<void>{
  const runtime=domain10Runtime();
  const span=runtime.tracer.startSpan("domain10.assurance.evaluate");
  span.setAttribute("domain10.assurance_run_id",runId);

  try{
    const result=await evaluateAssuranceRun(runId,workerId);
    runtime.metrics.increment("domain10_assurance_runs_total",{outcome:result.outcome});
    if(result.metricValue!==undefined){
      runtime.metrics.gauge(
        "domain10_assurance_metric_value",
        result.metricValue,
        {run_id:runId,outcome:result.outcome}
      );
    }
    runtime.logger.info("Domain 10 assurance run completed",{
      runId,
      outcome:result.outcome,
      metricValue:result.metricValue,
      thresholdValue:result.thresholdValue,
      comparison:result.comparison,
      sampleSize:result.sampleSize
    });
  }catch(error){
    await failAssuranceRun(
      runId,
      workerId,
      "ASSURANCE_EVALUATION_FAILED",
      error instanceof Error?error.message:"Unknown assurance evaluation error"
    );
    runtime.metrics.increment("domain10_assurance_run_failures_total");
    throw error;
  }finally{
    span.end();
  }
}
