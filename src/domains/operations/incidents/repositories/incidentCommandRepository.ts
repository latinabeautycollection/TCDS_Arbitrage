import { domain10Runtime } from "../../infrastructure/operationsRuntime";
import type { IncidentCommandInput,IncidentCommandResult,IncidentTransitionInput } from "../models/incidentTypes";

export async function resolveRecipientByMobile(mobileE164:string):Promise<string|null>{
  const r=await domain10Runtime().pool.query<{recipient_id:string}>(`
    SELECT recipient_id FROM operations.recipient_directory
    WHERE mobile_e164=$1 AND enabled
  `,[mobileE164]);
  return r.rows[0]?.recipient_id??null;
}

export async function applyIncidentCommand(input:IncidentCommandInput):Promise<IncidentCommandResult>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT command_id,incident_id,outcome,reason
    FROM operations.apply_incident_command_10d($1,$2,$3,$4,$5,$6::timestamptz,$7::uuid,$8)
  `,[input.commandId,input.source,input.incidentKey,input.recipientId,input.command,input.occurredAt,input.correlationId,input.evidenceHash]);
  const x=r.rows[0];
  if(!x) throw new Error("apply_incident_command_10d returned no row");
  return {commandId:x.command_id,incidentId:x.incident_id,outcome:x.outcome,reason:x.reason};
}

export async function transitionIncident(input:IncidentTransitionInput):Promise<void>{
  await domain10Runtime().pool.query(`
    SELECT operations.transition_incident_10d($1,$2,$3,$4,$5,$6::uuid)
  `,[input.incidentId,input.actorRecipientId,input.targetStatus,input.resolutionCode??null,input.reason,input.correlationId]);
}
