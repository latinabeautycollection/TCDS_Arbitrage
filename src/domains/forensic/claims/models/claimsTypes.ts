export type ActorType = 'user'|'worker'|'system'|'api'|'service_account';
export type AssuranceLevel = 'AAL1'|'AAL2';

export interface ClaimsPrincipal {
  readonly tenantKey:string;
  readonly actorType:ActorType;
  readonly actorId:string;
  readonly actorName?:string;
  readonly warehouseUserId:string;
  readonly warehouseEmployeeId:string;
  readonly warehouseAuthSessionId:string;
  readonly warehouseDeviceSessionId:string;
  readonly facilityId:string;
  readonly stationId?:string;
  readonly deviceId:string;
  readonly assuranceLevel:AssuranceLevel;
  readonly permissions:readonly string[];
}

export interface OpenClaimInput {
  readonly chainId:string;
  readonly claimCaseId:string;
  readonly returnIntakeLinkId?:string;
  readonly adjudicationGateId?:string;
  readonly shippingCustodyLinkId?:string;
  readonly arbShipmentId?:string;
  readonly ebayOrderId?:string;
  readonly idempotencyKey:string;
  readonly metadata?:Readonly<Record<string,unknown>>;
}
export interface LinkClaimEvidenceInput {
  readonly claimCaseLinkId:string;
  readonly evidenceRole:string;
  readonly forensicArtifactId?:string;
  readonly warehouseClaimEvidenceId?:string;
  readonly retailEvidenceArtifactId?:string;
  readonly retailProductId?:string;
  readonly retailOfferSnapshotId?:string;
  readonly required:boolean;
  readonly idempotencyKey:string;
  readonly metadata?:Readonly<Record<string,unknown>>;
}
export interface FileClaimInput {
  readonly claimCaseLinkId:string;
  readonly readinessAssessmentId:string;
  readonly externalClaimId:string;
  readonly filingChannel:string;
  readonly requestPayloadSha256:string;
  readonly responsePayloadSha256:string;
  readonly confirmationArtifactId:string;
  readonly filedAmount:number;
  readonly filedAt:string;
  readonly idempotencyKey:string;
}
export interface OpenDisputeInput {
  readonly chainId:string;
  readonly externalDisputeId:string;
  readonly disputeType:string;
  readonly ebayOrderId?:string;
  readonly ebayListingId?:string;
  readonly arbShipmentId?:string;
  readonly claimCaseLinkId?:string;
  readonly returnIntakeLinkId?:string;
  readonly fraudAssessmentId?:string;
  readonly disputedAmount:number;
  readonly openedAt:string;
  readonly responseDeadline?:string;
  readonly idempotencyKey:string;
  readonly metadata?:Readonly<Record<string,unknown>>;
}
export interface RecordRecoveryInput {
  readonly disputeCaseLinkId?:string;
  readonly claimCaseLinkId?:string;
  readonly recoverySource:string;
  readonly externalTransactionId:string;
  readonly transactionType:'PAYMENT'|'CREDIT'|'REVERSAL'|'FEE'|'DEDUCTIBLE'|'WRITE_OFF'|'ADJUSTMENT';
  readonly originalRecoveryTransactionId?:string;
  readonly amount:number;
  readonly currencyCode:string;
  readonly occurredAt:string;
  readonly payloadSha256:string;
  readonly idempotencyKey:string;
}
