export type HubDecisionStatus =
  | "BYPASS"
  | "ALLOW"
  | "ALLOW_WITH_REQUIREMENTS"
  | "HOLD"
  | "REPRICE"
  | "REQUOTE"
  | "MANUAL_REVIEW"
  | "REJECT";

export interface ProtectionRequirements {
  insuranceRequired: boolean;
  insuranceValueCents: number;
  insuranceMechanism: "NONE" | "THIRD_PARTY" | "CARRIER_DECLARED_VALUE";
  signatureRequired: boolean;
  adultSignatureRequired: boolean;
  restrictedDeliveryRequired: boolean;
  tamperEvidenceRequired: boolean;
  serialCaptureRequired: boolean;
  digitalWeightAuditRequired: boolean;
}

export interface ProtectionDecision {
  status: HubDecisionStatus;
  requirements: ProtectionRequirements;
  minimumCustomerShippingChargeCents: number;
  expectedNetProfitCents: number;
  worstCaseNetProfitCents: number;
  protectedMarginPct: number;
  reasonCodes: string[];
  humanReviewRequired: boolean;
}
