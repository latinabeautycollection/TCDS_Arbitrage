import type { ShippingIntelligenceDecision } from "../models/decisionEvidence";
import type { ShippingIntelligenceContext } from "../models/intelligenceContext";

export interface ShippingExecutionGateway {
  persistRecommendation(
    context: ShippingIntelligenceContext,
    decision: ShippingIntelligenceDecision
  ): Promise<void>;
  requestReconciliation?(shipmentId: number, correlationId: string): Promise<void>;
}
