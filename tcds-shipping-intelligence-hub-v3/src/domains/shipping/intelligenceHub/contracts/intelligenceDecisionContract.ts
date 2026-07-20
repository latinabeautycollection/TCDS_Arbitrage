import type { ShippingIntelligenceDecision } from "../models/decisionEvidence";
import type { ShippingIntelligenceContext } from "../models/intelligenceContext";

export interface ShippingIntelligenceHub {
  estimatePresaleShipping(context: ShippingIntelligenceContext): Promise<ShippingIntelligenceDecision>;
  evaluateSoldOrder(context: ShippingIntelligenceContext): Promise<ShippingIntelligenceDecision>;
  authorizeLabel(context: ShippingIntelligenceContext): Promise<ShippingIntelligenceDecision>;
  reconcileShipment(shipmentId: number, correlationId: string): Promise<void>;
}
