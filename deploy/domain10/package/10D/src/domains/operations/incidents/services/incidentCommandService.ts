import { incidentEnv } from "../config/incidentEnv";
import { applyIncidentCommand,resolveRecipientByMobile } from "../repositories/incidentCommandRepository";
import type { IncidentCommand,IncidentCommandResult } from "../models/incidentTypes";

const SMS_COMMAND=/^(ACK|OWN|DECLINE)\s+([A-Z0-9-]{6,80})$/i;

export function parseSmsIncidentCommand(text:string):{command:IncidentCommand;incidentKey:string}|null{
  const match=text.trim().match(SMS_COMMAND);
  if(!match) return null;
  return {command:match[1]!.toUpperCase() as IncidentCommand,incidentKey:match[2]!.toUpperCase()};
}

/** Called only after the existing Telnyx raw-body signature/timestamp verifier. */
export async function processVerifiedSmsIncidentCommand(args:{
  providerEventId:string;mobileE164:string;text:string;occurredAt:string;correlationId:string;evidenceHash:string;
}):Promise<IncidentCommandResult|null>{
  const parsed=parseSmsIncidentCommand(args.text);
  if(!parsed) return null; // START/STOP/HELP and unrelated SMS stay with existing SMS subsystem.

  const age=Math.abs(Date.now()-Date.parse(args.occurredAt))/1000;
  if(!Number.isFinite(age)||age>incidentEnv().DOMAIN10_INCIDENT_COMMAND_MAX_AGE_SECONDS){
    throw new Error("Incident SMS command is outside the accepted freshness window");
  }

  const recipientId=await resolveRecipientByMobile(args.mobileE164);
  if(!recipientId) throw new Error("No enabled TCDS recipient matches the verified SMS sender");

  return applyIncidentCommand({
    commandId:`TELNYX:${args.providerEventId}`,source:"SMS",incidentKey:parsed.incidentKey,
    recipientId,command:parsed.command,occurredAt:args.occurredAt,
    correlationId:args.correlationId,evidenceHash:args.evidenceHash
  });
}

export async function processAuthenticatedApplicationIncidentCommand(args:{
  requestId:string;incidentKey:string;recipientId:string;command:IncidentCommand;
  occurredAt:string;correlationId:string;evidenceHash:string;
}):Promise<IncidentCommandResult>{
  const age=Math.abs(Date.now()-Date.parse(args.occurredAt))/1000;
  if(!Number.isFinite(age)||age>incidentEnv().DOMAIN10_INCIDENT_COMMAND_MAX_AGE_SECONDS){
    throw new Error("Incident application command is outside the accepted freshness window");
  }
  return applyIncidentCommand({
    commandId:`APP:${args.requestId}`,source:"APPLICATION",incidentKey:args.incidentKey,
    recipientId:args.recipientId,command:args.command,occurredAt:args.occurredAt,
    correlationId:args.correlationId,evidenceHash:args.evidenceHash
  });
}
