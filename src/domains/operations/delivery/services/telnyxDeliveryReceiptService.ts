import type { NormalizedTelnyxDeliveryEvent } from "../models/deliveryTypes";
import { applyTelnyxDeliveryEvent } from "../repositories/deliveryReceiptRepository";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";

/**
 * Boundary contract:
 * This service accepts ONLY a webhook that the existing Telnyx webhook layer
 * has already verified cryptographically from the raw request body.
 *
 * 10C deliberately does not re-own signature verification, START/STOP/HELP,
 * HTTP routing, or consent projection from the existing SMS subsystem / 10A.
 */
export async function consumeVerifiedTelnyxDeliveryEvent(
  event: NormalizedTelnyxDeliveryEvent
): Promise<"APPLIED" | "DUPLICATE" | "IGNORED_STALE" | "UNMATCHED"> {
  const result = await applyTelnyxDeliveryEvent(event);
  domain10Runtime().metrics.increment("domain10_telnyx_receipt_total",{
    event_type:event.eventType,
    status:event.status,
    result
  });
  return result;
}
