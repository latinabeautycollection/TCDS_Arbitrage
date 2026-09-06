export type CapitalSafetyEvaluationState='ALLOW'|'ALLOW_WITH_GUARD'|'REVIEW'|'HOLD'|'BLOCK'|'UNKNOWN';
export type CapitalSafetyAssessmentState='ALLOW'|'ALLOW_WITH_GUARD'|'REVIEW'|'HOLD'|'BLOCK';
export type ControlResultState='PASS'|'WARN'|'REVIEW'|'HOLD'|'FAIL'|'UNKNOWN'|'NOT_APPLICABLE';
export type PurchaseLifecycleState='PROPOSED'|'QUEUED'|'APPROVED'|'RESERVED'|'COMMITTED'|'EXECUTING'|'EXECUTED'|'SETTLED'|'CANCELLED'|'RELEASED'|'UNKNOWN';

export interface CapitalSafetyPrincipal{reference:string;authSessionId:string;permissions:string[];}
export interface CapitalSafetyRequest{capitalAllocationRunId:number;sourceRecordId:string;correlationId:string;idempotencyKey:string;}

export interface PurchaseLifecycleEvidence{
  currentState:PurchaseLifecycleState;
  currentQueueStatus:string|null;
  currentStatus:string|null;
  approvedAt:Date|null;
  crossedSideEffectBoundary:boolean|null;
  duplicateIdentityConflict:boolean|null;
  reference:string;
  observedAt:Date;
}

export interface Domain2CapitalProposal{
  externalDecisionId:string;capitalAllocationRunId:number;sourceRecordId:string;decisionId:string|null;listingId:string|null;candidateId:string|null;
  categoryKey:string|null;familyKey:string|null;skuKey:string|null;supplierKey:string|null;marketplaceKey:string|null;
  requestedAmount:number;requiredCapital:number;currencyCode:string;executionStatus:string|null;purchaseQueueStatus:string|null;
  purchaseLifecycle:PurchaseLifecycleEvidence;
  currentAcquisitionEvidence:'PASS'|'FAIL'|'UNKNOWN';currentAcquisitionObservedAt:Date|null;currentAcquisitionEvidenceReference:string;
  createdAt:Date;
}

export interface FinancialState{
  sourceReference:string;observedAt:Date;completeness:'COMPLETE'|'PARTIAL'|'UNKNOWN'|'UNAVAILABLE';currencyCode:string;
  ledgerBalance:number|null;reservedCapital:number|null;committedCapital:number|null;pendingPurchaseExposure:number|null;
  settledPurchaseExposure:number|null;authoritativeCapitalAtRisk:number|null;authoritativeDailyCapitalAtRisk:number|null;unreconciledTransactions:number|null;
  availableToDeploy:number|null;domain2RemainingCapitalUsd:number|null;sourceHash:string;
}

export interface DimensionExposure{dimensionType:'CATEGORY'|'FAMILY'|'SKU'|'SUPPLIER'|'MARKETPLACE';dimensionKey:string|null;capitalAtRisk:number|null;observedAt:Date|null;sourceReference:string;}
export interface ReadinessEvidence{componentId:string;assessmentId:string;readinessState:string;canMutateState:boolean;capitalTechnicalReadiness:boolean;canCreateExternalSideEffects:boolean;evaluatedAt:Date;validUntil:Date|null;expired:boolean;}
export interface CapitalSafetyPolicy{governancePolicyId:string;governancePolicyVersionId:string;policySha256:string;configurationSha256:string;effectiveFrom:Date|null;effectiveUntil:Date|null;configuration:Record<string,unknown>;consumerDriftStatus:'MATCH'|'DRIFTED'|'UNKNOWN'|'UNAVAILABLE';consumerAcknowledged:boolean;}

export interface ExposureSnapshot{
  provisionalAuthorized:number;dailyAuthorized:number;
  authoritativeCapitalAtRisk:number;
  categoryProvisional:number;familyProvisional:number;skuProvisional:number;supplierProvisional:number;marketplaceProvisional:number;
  categoryAuthoritative:number|null;familyAuthoritative:number|null;skuAuthoritative:number|null;supplierAuthoritative:number|null;marketplaceAuthoritative:number|null;
}

export interface ControlResult{controlCode:string;controlSemanticVersion:number;result:ControlResultState;safetyCritical:boolean;reasonCode:string;measuredValue:Record<string,unknown>;thresholdValue:Record<string,unknown>;evidenceReference:Record<string,unknown>;evaluatedAt:Date;}
export interface CapitalSafetyDecision{evaluationState:CapitalSafetyEvaluationState;assessmentState:CapitalSafetyAssessmentState;reasonCodes:string[];controls:ControlResult[];validUntil:Date;}
export interface CapitalSafetyEvaluationInput{proposal:Domain2CapitalProposal;financial:FinancialState;readiness:ReadinessEvidence|null;policy:CapitalSafetyPolicy|null;exposure:ExposureSnapshot;now:Date;}
export interface ExecutionRevalidationResult{externalDecisionId:string;assessmentId:string|null;eligible:boolean;reasonCodes:string[];checkedAt:Date;}
