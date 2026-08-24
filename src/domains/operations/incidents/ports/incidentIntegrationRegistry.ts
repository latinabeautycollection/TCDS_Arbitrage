import type { NotificationDecisionPort } from "./notificationDecisionPort";
export interface IncidentIntegrationRegistry{notificationDecision:NotificationDecisionPort;}
let registry:IncidentIntegrationRegistry|undefined;
export function configureIncidentIntegrationRegistry(value:IncidentIntegrationRegistry):void{
  if(registry) throw new Error("Domain 10D integration registry already configured");
  registry=value;
}
export function incidentIntegrationRegistry():IncidentIntegrationRegistry{
  if(!registry) throw new Error("Domain 10D integration registry has not been configured");
  return registry;
}
