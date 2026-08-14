
import { z } from "zod";

export const outcomeObservationSchema = z.object({
  passportId: z.string().uuid(),
  outcomeType: z.enum([
    "SALE_COMPLETED","RETURN_OPENED","RETURN_ACCEPTED","RETURN_DENIED",
    "BUYER_DISPUTE_OPENED","BUYER_DISPUTE_WON","BUYER_DISPUTE_LOST",
    "CARRIER_CLAIM_FILED","CARRIER_CLAIM_PAID","CARRIER_CLAIM_DENIED",
    "RETAILER_RECOVERY_RECEIVED","ITEM_RESTOCKED","ITEM_REPAIRED",
    "ITEM_DISPOSED","INVENTORY_LOSS","LISTING_DEFECT",
    "LATE_SHIPMENT","DELIVERY_EXCEPTION",
  ]),
  observedAt: z.string().datetime(),
  idempotencyKey: z.string().min(8).max(240),
  payload: z.record(z.string(), z.unknown()).default({}),
});
