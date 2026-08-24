import { domain10Runtime } from "../../infrastructure/operationsRuntime";
import type { ActivationClaim,ActivationResult } from "../models/incidentTypes";

export async function claimIncidentActivations(workerId:string,batchSize:number,leaseSeconds:number):Promise<ActivationClaim[]>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT activation_id,notification_id,attempt_count
    FROM operations.claim_incident_activation_10d($1,$2,$3)
  `,[workerId,batchSize,leaseSeconds]);
  return r.rows.map((x:any)=>({activationId:x.activation_id,notificationId:x.notification_id,attemptCount:x.attempt_count}));
}

export async function activateIncident(notificationId:string,workerId:string):Promise<ActivationResult>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT incident_id,incident_key,created,escalation_state
    FROM operations.activate_incident_from_notification_10d($1,$2)
  `,[notificationId,workerId]);
  const x=r.rows[0];
  if(!x) throw new Error("activate_incident_from_notification_10d returned no row");
  return {incidentId:x.incident_id,incidentKey:x.incident_key,created:x.created,escalationState:x.escalation_state};
}

export async function failIncidentActivation(notificationId:string,workerId:string,error:string):Promise<void>{
  await domain10Runtime().pool.query(`SELECT operations.fail_incident_activation_10d($1,$2,$3)`,[notificationId,workerId,error.slice(0,1000)]);
}
