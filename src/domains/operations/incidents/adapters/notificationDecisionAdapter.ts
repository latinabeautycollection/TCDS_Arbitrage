import type { NotificationDecisionPort } from "../ports/notificationDecisionPort";
import type { EscalationEventEnvelope } from "../models/incidentTypes";

/** Structural adapter for reviewed 10B acceptOperationalEvent(). */
export function adaptReviewed10BEventIntake(
  accept:(input:unknown)=>Promise<{eventId:string;inserted:boolean}>
):NotificationDecisionPort{
  return {acceptOperationalEvent:(event:EscalationEventEnvelope)=>accept(event)};
}
