import os from "node:os";
import { incidentEnv } from "../config/incidentEnv";
import { claimDueEscalations } from "../repositories/escalationRepository";
import { processEscalationClaim } from "../services/escalationService";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";
const workerId=`${os.hostname()}:${process.pid}:10D-escalation`;
export async function runIncidentEscalationBatch():Promise<number>{
  const env=incidentEnv(); if(!env.DOMAIN10_INCIDENTS_ENABLED) return 0;
  const claims=await claimDueEscalations(workerId,env.DOMAIN10_ESCALATION_BATCH_SIZE,env.DOMAIN10_ESCALATION_LEASE_SECONDS);
  for(const c of claims){try{await processEscalationClaim(c,workerId);}catch(error){domain10Runtime().logger.error("10D escalation emission failed",{incidentId:c.incidentId,step:c.stepNumber,repeat:c.repeatNumber,errorName:error instanceof Error?error.name:"UnknownError"});}}
  return claims.length;
}
