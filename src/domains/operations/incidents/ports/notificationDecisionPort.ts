import type { EscalationEventEnvelope } from "../models/incidentTypes";

export interface NotificationDecisionPort{
  /**
   * Hands a 10D-generated escalation fact to the existing 10B authoritative
   * operational-event intake. 10D never creates notification plans directly.
   */
  acceptOperationalEvent(event:EscalationEventEnvelope):Promise<{eventId:string;inserted:boolean}>;
}
