export type ActorType='user'|'worker'|'system'|'api'|'service_account';
export interface CasefilePrincipal{readonly tenantKey:string;readonly actorType:ActorType;readonly actorId:string;
 readonly actorName?:string;readonly warehouseUserId:string;readonly warehouseEmployeeId:string;
 readonly warehouseAuthSessionId:string;readonly warehouseDeviceSessionId:string;readonly facilityId:string;
 readonly stationId?:string;readonly deviceId:string;readonly assuranceLevel:'AAL1'|'AAL2';readonly permissions:readonly string[]}
export interface OpenLegalHoldInput{readonly chainId:string;readonly holdCode:string;readonly holdType:string;
 readonly title:string;readonly reason:string;readonly authorityReference?:string;readonly effectiveAt:string;
 readonly expiresAt?:string;readonly idempotencyKey:string}
export interface AddHoldScopeInput{readonly legalHoldId:string;readonly scopeType:string;readonly scopeReference:string;
 readonly includeDescendants:boolean;readonly idempotencyKey:string}
export interface RequestHoldReleaseInput{readonly legalHoldId:string;readonly reason:string;
 readonly conflictCheck:Readonly<Record<string,unknown>>;readonly idempotencyKey:string}
export interface DecideHoldReleaseInput{readonly releaseRequestId:string;readonly decision:'APPROVED'|'REJECTED';
 readonly reason:string;readonly verificationId:string;readonly warehouseOverrideId?:string;readonly idempotencyKey:string}
export interface StorageVerificationObservation{readonly memberId:string;readonly adapterName:string;readonly adapterVersion:string;
 readonly objectExists:boolean;readonly observedSha256?:string;readonly observedStorageVersionId?:string;
 readonly objectLockStatus?:string;readonly retentionUntil?:string;readonly replicationStatus?:string;
 readonly archiveRetrievable?:boolean;readonly providerResponseSha256:string;readonly observedAt:string}
export interface CreateDossierInput{readonly chainId:string;readonly dossierCode:string;readonly purpose:string;readonly subjectType:'FORENSIC_CHAIN'|'CLAIM_CASE'|'DISPUTE_CASE'|'RETURN_CASE'|'SHIPMENT'|'ORDER'|'ITEM'|'PACKAGE';readonly subjectReference:string;readonly includeRetail:boolean;readonly includeArb:boolean;readonly includeWarehouse:boolean;readonly includeForensic:boolean;readonly legalHoldId:string;readonly preservationVerificationId:string;readonly idempotencyKey:string}
export interface SignResult{readonly signatureBase64:string;readonly publicKeyReference:string;readonly certificateChainReference?:string;readonly timestampAuthorityReference?:string;readonly providerResponseSha256:string;readonly signedAt:string}
