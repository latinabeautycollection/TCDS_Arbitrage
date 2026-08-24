import { domain10Runtime } from "../../infrastructure/operationsRuntime";
import type { NormalizedTelnyxDeliveryEvent } from "../models/deliveryTypes";

export async function applyTelnyxDeliveryEvent(
  event: NormalizedTelnyxDeliveryEvent
): Promise<"APPLIED" | "DUPLICATE" | "IGNORED_STALE" | "UNMATCHED"> {
  const r = await domain10Runtime().pool.query<{
    result: "APPLIED" | "DUPLICATE" | "IGNORED_STALE" | "UNMATCHED";
  }>(`
    SELECT operations.apply_telnyx_delivery_event_10c(
      $1,$2,$3,$4::timestamptz,$5,$6::jsonb,$7::jsonb,$8::uuid
    ) AS result
  `, [
    event.providerEventId,
    event.providerMessageId,
    event.eventType,
    event.occurredAt,
    event.status,
    JSON.stringify(event.errors),
    JSON.stringify(event.rawEvidence),
    event.correlationId ?? null
  ]);

  return r.rows[0]?.result ?? "UNMATCHED";
}
