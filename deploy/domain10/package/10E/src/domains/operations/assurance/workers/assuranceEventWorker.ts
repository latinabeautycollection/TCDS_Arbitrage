import os from "node:os";
import { assuranceEnv } from "../config/assuranceEnv";
import { claimAssuranceEvents } from "../repositories/assuranceEventRepository";
import { emitAssuranceEvent } from "../services/assuranceEventEmissionService";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";

const workerId=`${os.hostname()}:${process.pid}:10E-assurance-emitter`;

export async function runAssuranceEventEmissionBatch():Promise<number>{
  const env=assuranceEnv();
  if(!env.DOMAIN10_ASSURANCE_ENABLED) return 0;

  const events=await claimAssuranceEvents(
    workerId,
    env.DOMAIN10_ASSURANCE_EMISSION_BATCH_SIZE,
    env.DOMAIN10_ASSURANCE_EMISSION_LEASE_SECONDS
  );

  let processed=0;
  for(const event of events){
    try{
      await emitAssuranceEvent(event,workerId);
    }catch(error){
      domain10Runtime().logger.error("Domain 10 assurance event worker failed",{
        assuranceEventId:event.assuranceEventId,
        errorName:error instanceof Error?error.name:"UnknownError"
      });
    }finally{
      processed++;
    }
  }
  return processed;
}
