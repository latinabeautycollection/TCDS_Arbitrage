import type { AssuranceEventEnvelope } from "../models/assuranceTypes";
import type { AssuranceEventIntakePort } from "../ports/assuranceEventIntakePort";

/** Structural adapter around reviewed 10B acceptOperationalEvent(). */
export function adaptReviewed10BEventIntake(
  accept:(input:unknown)=>Promise<{eventId:string;inserted:boolean}>
):AssuranceEventIntakePort{
  return {
    acceptOperationalEvent:(event:AssuranceEventEnvelope)=>accept(event)
  };
}
