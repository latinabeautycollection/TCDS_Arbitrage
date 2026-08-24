import type { OperationalEventEnvelope } from "../models/eventTypes";
import { validateEnvelope,validatePayloadAgainstContract } from "../validators/eventEnvelopeValidator";
import { getEventContract } from "../repositories/eventContractRepository";
import { ingestOperationalEvent } from "../repositories/eventIntakeRepository";
import { OperationsDecisionError } from "../errors/OperationsDecisionError";
import { domain10Runtime } from "../infrastructure/operationsRuntime";

export async function acceptOperationalEvent(input:unknown):Promise<{eventId:string;inserted:boolean}>{
  const event:OperationalEventEnvelope=validateEnvelope(input);
  const contract=await getEventContract(event.eventType,event.schemaVersion,event.occurredAt);
  if(!contract){
    throw new OperationsDecisionError(
      `No governed event contract for ${event.eventType} v${event.schemaVersion} at occurred_at`,
      "EVENT_CONTRACT_MISSING",false
    );
  }
  validatePayloadAgainstContract(event,contract);

  try{
    const result=await ingestOperationalEvent(event,contract.schemaHash);
    domain10Runtime().metrics.increment(
      result.inserted?"domain10_events_ingested_total":"domain10_events_deduplicated_total",
      {event_type:event.eventType}
    );
    return result;
  }catch(cause){
    if(cause instanceof OperationsDecisionError) throw cause;
    throw new OperationsDecisionError("Operational event persistence failed","EVENT_CONFLICT",false,{cause});
  }
}
