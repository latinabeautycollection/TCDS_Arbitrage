import type { LabelAuthorizationGateway } from "../contracts/labelAuthorizationGateway";
import type { ShippingIntelligenceDecision } from "../models/decisionEvidence";

export class ExistingLabelServiceAdapter implements LabelAuthorizationGateway {
  async authorize(decision: ShippingIntelligenceDecision): Promise<{
    authorized: boolean;
    authorizationId: string;
    reasonCodes: string[];
  }> {
    const authorized = ["ALLOW", "ALLOW_WITH_REQUIREMENTS"].includes(decision.protection.status);
    return {
      authorized,
      authorizationId: decision.decisionId,
      reasonCodes: authorized ? ["HUB_AUTHORIZED"] : ["HUB_NOT_AUTHORIZED"]
    };
  }
}
