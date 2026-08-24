import type { AssuranceEventEnvelope } from "../models/assuranceTypes";

export interface AssuranceEventIntakePort{
  /**
   * Hands a 10E reliability/compliance fact to reviewed 10B.
   * 10E never creates notification plans or provider sends directly.
   */
  acceptOperationalEvent(
    event:AssuranceEventEnvelope
  ):Promise<{eventId:string;inserted:boolean}>;
}
