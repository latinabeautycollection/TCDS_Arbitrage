export type ActorType='user'|'worker'|'system'|'api'|'service_account';
export type AssuranceSubjectType='GLOBAL'|'FORENSIC_CHAIN'|'FACILITY'|'CLAIM_CASE'|'DISPUTE_CASE'|'LEGAL_HOLD'|'CASE_DOSSIER'|'RETAIL_PLATFORM'|'WORKER';
export interface AssurancePrincipal{
 readonly tenantKey:string;readonly actorType:ActorType;readonly actorId:string;readonly actorName?:string;
 readonly warehouseUserId:string;readonly warehouseEmployeeId:string;readonly warehouseAuthSessionId:string;
 readonly warehouseDeviceSessionId:string;readonly facilityId:string;readonly stationId?:string;
 readonly deviceId:string;readonly assuranceLevel:'AAL1'|'AAL2';readonly permissions:readonly string[];
}
export interface RunControlEvaluationInput{
 readonly controlCode:string;readonly subjectType:AssuranceSubjectType;readonly subjectReference:string;
 readonly evaluationWindowStart:string;readonly evaluationWindowEnd:string;readonly idempotencyKey:string;
}
export interface FindingFilters{readonly status?:string;readonly severity?:string;readonly controlCode?:string;
 readonly ownerUserId?:string;readonly overdue?:boolean;readonly facilityId?:string;readonly limit:number;readonly offset:number}
export interface OpenCertificationCampaignInput{
 readonly campaignCode:string;readonly campaignType:string;readonly title:string;
 readonly periodStart:string;readonly periodEnd:string;readonly dueAt:string;
 readonly scopeJson:Readonly<Record<string,unknown>>;readonly idempotencyKey:string;
}
