export const gateStages = [
  "RETAIL_SOURCE_QUALITY",
  "ACQUISITION_PROFIT_DEFENSE",
  "SOURCE_RECOVERY_WINDOW",
  "RECEIVING_IDENTITY",
  "INVENTORY_INTEGRITY",
  "LISTING_DEFENSIBILITY",
  "ORDER_FULFILLMENT",
  "PACKING_SHIPMENT_RELEASE",
  "DELIVERY_INTERVENTION",
  "RETURN_DISPUTE_RECOVERY",
] as const;

export type GateStage = (typeof gateStages)[number];
export type GateStatus = "ALLOW" | "ALLOW_WITH_CONTROLS" | "REVIEW" | "HOLD" | "BLOCK";
export type ReviewLevel = "AUTO" | "AI_ASSISTED" | "SUPERVISOR" | "EXECUTIVE";
export type RiskTier = "GREEN" | "GUARDED" | "ELEVATED" | "HIGH" | "CRITICAL";

export interface FeatureSnapshotInput {
  passportId: string;
  passportVersionId: string;
  gateStage: GateStage;
  featureSchemaVersion: string;
  features: Record<string, unknown>;
  sourceDigest: Record<string, unknown>;
  policyVersionId: string;
  modelVersionId?: string | null;
  freshForSeconds: number;
}

export interface RiskAssessmentInput {
  featureSnapshotId: string;
  riskScore: number;
  returnProbability?: number | null;
  disputeProbability?: number | null;
  fraudProbability?: number | null;
  expectedLossUsd: number;
  expectedLaborMinutes: number;
  defensibilityScore?: number | null;
  executionIntegrityScore?: number | null;
  evidenceReliabilityScore?: number | null;
  confidenceScore: number;
  rulesetVersion: string;
  payload: Record<string, unknown>;
  reasonCodes: string[];
}

export interface PreventionDecisionInput {
  riskAssessmentId: string;
  gateStatus: GateStatus;
  reviewLevel: ReviewLevel;
  decisionDeadline?: Date | null;
  expiresAt: Date;
  payload: Record<string, unknown>;
  reasonCodes: string[];
}
