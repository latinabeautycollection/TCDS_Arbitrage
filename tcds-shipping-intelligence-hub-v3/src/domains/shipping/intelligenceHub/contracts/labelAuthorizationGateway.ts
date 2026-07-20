import type { ShippingIntelligenceDecision } from "../models/decisionEvidence";

export interface LabelAuthorizationGateway {
  authorize(decision: ShippingIntelligenceDecision): Promise<{
    authorized: boolean;
    authorizationId: string;
    reasonCodes: string[];
  }>;
}
