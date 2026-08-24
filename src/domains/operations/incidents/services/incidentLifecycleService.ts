import { transitionIncident } from "../repositories/incidentCommandRepository";
import type { IncidentTransitionInput } from "../models/incidentTypes";
export async function transitionIncidentLifecycle(input:IncidentTransitionInput):Promise<void>{
  // Caller authentication belongs to the existing application/API layer.
  // PostgreSQL independently authorizes the recipient against the incident.
  await transitionIncident(input);
}
