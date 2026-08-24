import os from "node:os";
import { incidentEnv } from "../config/incidentEnv";
import { claimAckDeadlines,recordAckDeadlineBreach } from "../repositories/ackDeadlineRepository";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";
const workerId=`${os.hostname()}:${process.pid}:10D-ack-deadline`;
export async function runAcknowledgementDeadlineBatch():Promise<number>{
  const env=incidentEnv(); if(!env.DOMAIN10_INCIDENTS_ENABLED) return 0;
  const claims=await claimAckDeadlines(workerId,env.DOMAIN10_ACK_DEADLINE_BATCH_SIZE,env.DOMAIN10_ACK_DEADLINE_LEASE_SECONDS);
  for(const c of claims){try{await recordAckDeadlineBreach(c.deadlineId,workerId);}catch(error){domain10Runtime().logger.error("10D acknowledgement deadline processing failed",{incidentId:c.incidentId,errorName:error instanceof Error?error.name:"UnknownError"});}}
  return claims.length;
}
