export const ACCESS_SCOPES=['metadata:read','content:read','artifact:download','dossier:verify','case:search','disclosure:export'] as const;
export type AccessScope=typeof ACCESS_SCOPES[number];
export const ACCESS_SUBJECT_TYPES=['CHAIN','ARTIFACT','CASE','DOSSIER','DISCLOSURE','RETAIL_EVIDENCE','WAREHOUSE_EVIDENCE'] as const;
export type AccessSubjectType=typeof ACCESS_SUBJECT_TYPES[number];
export interface AccessPrincipal{
 readonly tenantKey:string;readonly userId:string;readonly authSessionId:string;readonly deviceId?:string;
 readonly facilityId?:string;readonly assuranceLevel:'AAL1'|'AAL2';readonly permissions:readonly string[];
}
export interface ProcessContext{readonly processRunId:string;readonly processStepId:string;readonly correlationId:string}
export interface BeginAccessInput{readonly subjectType:AccessSubjectType;readonly subjectReference:string;readonly action:string;
 readonly scope:AccessScope;readonly purpose:string;readonly breakGlassSessionId?:string;readonly clientIp?:string;
 readonly userAgentHash?:string}
export interface AccessAuthorization{readonly receiptId:string;readonly token:string;readonly expiresAt:string;
 readonly source:'GRANT'|'BREAK_GLASS';readonly sourceId:string}
export interface ProtectedResult<T>{readonly value:T;readonly responseBytes?:number;readonly digestSource?:string|Buffer}
