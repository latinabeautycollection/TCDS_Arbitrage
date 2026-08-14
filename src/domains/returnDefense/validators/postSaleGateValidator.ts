
import { z } from "zod";

export const postSaleGateStageSchema = z.enum([
  "LISTING_DEFENSIBILITY",
  "ORDER_FULFILLMENT",
  "PACKING_SHIPMENT_RELEASE",
  "DELIVERY_INTERVENTION",
  "RETURN_DISPUTE_RECOVERY",
]);

export const enqueuePostSaleGateSchema = z.object({
  passportId: z.string().uuid(),
  gateStage: postSaleGateStageSchema,
  triggerType: z.enum([
    "LISTING_READY","ORDER_RECEIVED","PACKAGE_READY",
    "TRACKING_EVENT","DELIVERY_EXCEPTION","RETURN_OPENED",
    "DISPUTE_OPENED","CLAIM_UPDATED","MANUAL_REEVALUATION",
  ]),
  triggerExternalReferenceId: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(0).max(100).default(50),
  idempotencyKey: z.string().min(8).max(240),
});
