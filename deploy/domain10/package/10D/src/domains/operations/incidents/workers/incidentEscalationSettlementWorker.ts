import os from "node:os";
import { incidentEnv } from "../config/incidentEnv";
import { claimEscalationSettlements } from "../repositories/escalationRepository";
import { processEscalationSettlement } from "../services/escalationSettlementService";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";
const workerId=`${os.hostname()}:${process.pid}:10D-escalation-settlement`;
export async function runIncidentEscalationSettlementBatch():Promise<number>{
  const env=incidentEnv(); if(!env.DOMAIN10_INCIDENTS_ENABLED) return 0;
  const claims=await claimEscalationSettlements(workerId,env.DOMAIN10_ESCALATION_SETTLEMENT_BATCH_SIZE,env.DOMAIN10_ESCALATION_SETTLEMENT_LEASE_SECONDS);
  for(const c of claims){try{await processEscalationSettlement(c.emissionId,workerId);}catch(error){domain10Runtime().logger.error("10D escalation settlement failed",{emissionId:c.emissionId,errorName:error instanceof Error?error.name:"UnknownError"});}}
  return claims.length;
}
