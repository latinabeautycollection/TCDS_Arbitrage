import os from "node:os";
import { incidentEnv } from "../config/incidentEnv";
import { claimIncidentActivations } from "../repositories/incidentActivationRepository";
import { processIncidentActivation } from "../services/incidentActivationService";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";
const workerId=`${os.hostname()}:${process.pid}:10D-activation`;
export async function runIncidentActivationBatch():Promise<number>{
  const env=incidentEnv(); if(!env.DOMAIN10_INCIDENTS_ENABLED) return 0;
  const claims=await claimIncidentActivations(workerId,env.DOMAIN10_INCIDENT_ACTIVATION_BATCH_SIZE,env.DOMAIN10_INCIDENT_ACTIVATION_LEASE_SECONDS);
  for(const c of claims){try{await processIncidentActivation(c.notificationId,workerId);}catch(error){domain10Runtime().logger.error("10D incident activation failed",{notificationId:c.notificationId,errorName:error instanceof Error?error.name:"UnknownError"});}}
  return claims.length;
}
