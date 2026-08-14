
import { z } from "zod";
export const preSaleGateStageSchema=z.enum([
 "RETAIL_SOURCE_QUALITY","ACQUISITION_PROFIT_DEFENSE",
 "SOURCE_RECOVERY_WINDOW","RECEIVING_IDENTITY","INVENTORY_INTEGRITY",
]);
export const gateEvaluationRequestSchema=z.object({
 passportId:z.string().uuid(),
 gateStage:preSaleGateStageSchema,
 input:z.record(z.string(),z.unknown()),
});
