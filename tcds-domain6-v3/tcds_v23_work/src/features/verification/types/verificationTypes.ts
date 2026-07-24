export type GateState = 'PASS' | 'WARNING' | 'ACTION_REQUIRED' | 'BLOCKED' | 'PROCESSING' | 'NOT_APPLICABLE' | 'OVERRIDDEN';
export type VerificationOutcome = 'DRAFT' | 'VERIFIED' | 'VERIFIED_WITH_WARNING' | 'REVIEW_REQUIRED' | 'REJECTED';
export type ReviewDecision = 'APPROVE' | 'REJECT';
export type InspectionCardType = 'IDENTITY' | 'PHOTOS' | 'ACCESSORIES' | 'CONDITION' | 'POWER_TEST' | 'SAFETY' | 'FRAUD' | 'RISK' | 'ATTRIBUTE_CONFIRMATION' | 'SERIAL_REVIEW' | 'SEALED_PRODUCT' | 'BUNDLE';

export interface VerificationContext {
  verificationId: string;
  itemId: string;
  internalBarcode: string;
  productTitle: string;
  category: string;
  facilityCode: string;
  stationCode: string;
  photoSessionId: string;
  profileCode: string;
  profileVersion: number;
  claimedByDisplayName?: string;
  claimExpiresAt?: string;
}

export interface EvidenceSummary {
  accepted: number;
  required: number;
  pending: number;
  rejected: number;
  integrityVerified: boolean;
}

export interface DecisionOption {
  value: string;
  label: string;
  destructive?: boolean;
}

export interface AdaptiveCard {
  cardId: string;
  type: InspectionCardType;
  title: string;
  summary: string;
  state: GateState;
  confidence?: number;
  reasons: string[];
  systemFacts: Array<{ label: string; value: string }>;
  operatorPrompt?: string;
  options?: DecisionOption[];
  selectedValue?: string;
  notesRequired?: boolean;
  notes?: string;
  blocking: boolean;
  sequenceNo: number;
  unlocked: boolean;
}

export interface CompletionGate {
  gatePassed: boolean;
  outcome: VerificationOutcome;
  identity: GateState;
  photos: GateState;
  accessories: GateState;
  condition: GateState;
  powerTest: GateState;
  safety: GateState;
  fraud: GateState;
  risk: GateState;
  blockingIssues: string[];
  warnings: string[];
  overrideApplied: boolean;
}

export interface VerificationSession {
  context: VerificationContext;
  evidence: EvidenceSummary;
  cards: AdaptiveCard[];
  completionGate: CompletionGate;
  operatorAttested: boolean;
  status: VerificationOutcome;
  aiAvailable: boolean;
  online: boolean;
  lastSavedAt?: string;
  nextWorkflow?: { route: string; workflowToken: string };
}

export interface ApiProblem {
  code: string;
  message: string;
  requestId?: string;
  retryable?: boolean;
}
