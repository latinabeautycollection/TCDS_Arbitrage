import type { CarrierDecision } from "./carrierDecision";
import type { DestinationIntelligence } from "./destinationIntelligence";
import type { PricingIntelligence } from "./pricingIntelligence";
import type { ProfitDecision } from "./profitDecision";
import type { ProtectionDecision } from "./protectionDecision";
import type { RiskDecision } from "./riskDecision";
import type { EvaluationStage } from "./intelligenceContext";

export interface ShippingIntelligenceDecision {
  decisionId: string;
  idempotencyKey: string;
  correlationId: string;
  stage: EvaluationStage;
  policyVersion: string;
  modelVersion: string;
  rulesetVersion: string;
  createdAt: Date;
  inputHash: string;
  destination?: DestinationIntelligence;
  pricing: PricingIntelligence;
  carrier: CarrierDecision;
  risk: RiskDecision;
  profit: ProfitDecision;
  protection: ProtectionDecision;
  evidenceHash: string;
  explanation: string[];
  shadowOnly: boolean;
  failClosed: boolean;
}
