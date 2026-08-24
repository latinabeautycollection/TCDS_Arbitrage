import { activateIncident,failIncidentActivation } from "../repositories/incidentActivationRepository";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";
export async function processIncidentActivation(notificationId:string,workerId:string):Promise<void>{
  const runtime=domain10Runtime();
  try{
    const result=await activateIncident(notificationId,workerId);
    runtime.metrics.increment("domain10_incident_activation_total",{created:String(result.created),escalation_state:result.escalationState});
    runtime.logger.info("Domain 10 incident activation completed",{notificationId,incidentId:result.incidentId,incidentKey:result.incidentKey,escalationState:result.escalationState});
  }catch(error){
    await failIncidentActivation(notificationId,workerId,error instanceof Error?error.message:"Unknown activation error");
    runtime.metrics.increment("domain10_incident_activation_failure_total");
    throw error;
  }
}
