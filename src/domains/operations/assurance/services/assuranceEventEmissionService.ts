import { assuranceEnv } from "../config/assuranceEnv";
import { assuranceEventIntake } from "../ports/assuranceIntegrationRegistry";
import {
  failAssuranceEventEmission,
  markAssuranceEventEmitted
} from "../repositories/assuranceEventRepository";
import type { ClaimedAssuranceEvent } from "../models/assuranceTypes";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";

export async function emitAssuranceEvent(
  claimed:ClaimedAssuranceEvent,
  workerId:string
):Promise<void>{
  const runtime=domain10Runtime();
  const span=runtime.tracer.startSpan("domain10.assurance.emit");
  span.setAttribute("domain10.assurance_event_id",claimed.assuranceEventId);
  span.setAttribute("domain10.event_type",claimed.event.eventType);

  try{
    const result=await assuranceEventIntake().acceptOperationalEvent(claimed.event);
    await markAssuranceEventEmitted(
      claimed.assuranceEventId,
      workerId,
      result.eventId
    );
    runtime.metrics.increment("domain10_assurance_events_emitted_total",{
      event_type:claimed.event.eventType,
      inserted:String(result.inserted)
    });
  }catch(error){
    const disposition=await failAssuranceEventEmission(
      claimed.assuranceEventId,
      workerId,
      error instanceof Error?error.message:"Unknown assurance emission error",
      assuranceEnv().DOMAIN10_ASSURANCE_EMISSION_RETRY_MS
    );
    runtime.metrics.increment("domain10_assurance_event_emission_failures_total",{
      event_type:claimed.event.eventType,
      disposition
    });
  }finally{
    span.end();
  }
}
