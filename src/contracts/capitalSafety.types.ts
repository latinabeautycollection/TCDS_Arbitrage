export type SafetyStatus = 'PASSED' | 'BLOCKED' | 'REVIEW' | 'ERROR';
export type GateStatus = 'PASS' | 'BLOCK' | 'REVIEW';
export type ReplayStatus = 'PASS' | 'FAIL' | 'NOT_RUN';
export type GroundingStatus = 'PASS' | 'FAIL' | 'REVIEW';

export interface CapitalSafetyPolicy {
  policyVersion: string;
  minCompGroundingScore: number;
  minIdentityConfidence: number;
  minCompCount: number;
  maxActiveToSoldRatio: number;
  maxRiskScore: number;
  blockUngroundedBuy: boolean;
  ledgerRequiredForBuy: boolean;
}

export interface SafetyDecisionInput {
  listingId: string;
  candidateId?: number | null;
  opportunityQueueId?: number | null;
  decisionId?: string | null;
  decision: 'BUY' | 'WATCH' | 'PASS' | 'REVIEW' | 'REJECT';
  expectedProfitUsd?: number | null;
  roiPct?: number | null;
  priorityScore?: number | null;
  riskScore?: number | null;
  identityConfidence?: number | null;
  soldCount?: number | null;
  activeCount?: number | null;
  activeToSoldRatio?: number | null;
  compGroundingScore?: number | null;
  replayStatus?: ReplayStatus;
  ledgerContinuityOk?: boolean;
  reasonCodes?: string[];
  riskFlags?: string[];
  correlationId: string;
  // Added to enforce Phase 2.9 BUY-gate spec
  profitAnalysisDecisionCode?: string | null;
  dedupeGateStatus?: string | null;
  reviewRequired?: boolean | null;
  isBundle?: boolean | null;
  candidateTitle?: string | null;
  totalCostBasisUsd?: number | null;
  endTime?: string | null;
}

export interface CapitalSafetyGateResult {
  assessmentStatus: SafetyStatus;
  capitalGateStatus: GateStatus;
  gateReasonCodes: string[];
  riskFlags: string[];
  allowedDecision: 'BUY' | 'WATCH' | 'PASS' | 'REVIEW' | 'REJECT';
  explanation: string;
}

export interface ForensicLedgerWriteInput {
  correlationId: string;
  entityType: string;
  entityId: string;
  mutationType: string;
  actor: string;
  before?: unknown;
  after: unknown;
  payload?: unknown;
}

export interface ReplayInputSnapshot {
  entityKey: string;
  inputJson: unknown;
  outputJson: unknown;
  scoringVersion: string;
  policyVersion: string;
}

export interface ReplayResult {
  entityKey: string;
  passed: boolean;
  inputHash: string;
  expectedOutputHash: string;
  actualOutputHash: string;
  driftReason?: string;
}

export interface CompGroundingInput {
  listingId: string;
  candidateId?: number | null;
  opportunityQueueId?: number | null;
  soldCount: number;
  activeCount: number;
  identityConfidence: number;
  titleFitScore: number;
  categoryFitScore: number;
  conditionFitScore: number;
  evidenceJson: Record<string, unknown>;
}

export interface CompGroundingResult {
  groundingScore: number;
  groundingStatus: GroundingStatus;
  reasonCodes: string[];
  activeToSoldRatio: number | null;
}
