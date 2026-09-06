export type ReleaseState='DRAFT'|'SEALED'|'CERTIFICATION_RUNNING'|'CERTIFIED'|'CERTIFIED_WITH_RESTRICTIONS'|'REJECTED'|'BLOCKED'|'SUPERSEDED'|'REVOKED';
export type CertificationPhase='PRE_DEPLOYMENT'|'CANARY'|'POST_DEPLOYMENT'|'ROLLBACK';
export type GateResult='PASS'|'PASS_WITH_RESTRICTIONS'|'FAIL'|'BLOCKED'|'NOT_APPLICABLE';
export interface ReleasePrincipal{reference:string;authSessionId:string;permissions:string[]}
export interface RegisterReleaseRequest{manifest:Record<string,unknown>;requestId:string;correlationId:string;idempotencyKey:string}
export interface StartCertificationRequest{releaseCandidateId:string;environment:'DEV'|'TEST'|'STAGING'|'PRODUCTION'|'DISASTER_RECOVERY';phase:CertificationPhase;requestId:string;correlationId:string}
export interface GateEvidenceRequest{
 certificationRunId:string;gateCode:string;gateVersion:number;result:GateResult;evidenceReference:string;
 evidencePayload:Record<string,unknown>;startedAt:string;completedAt:string;toolRuntime:Record<string,unknown>;
 requestId:string;correlationId:string;
}
export interface BeginReplayRequest{certificationRunId:string;replayScenarioId:string;requestId:string;correlationId:string}
export interface CompleteReplayRequest{replayRunId:string;actualResult:Record<string,unknown>;difference:Record<string,unknown>}
export interface ReleaseLogger{info(message:string,fields?:Record<string,unknown>):void;warn(message:string,fields?:Record<string,unknown>):void;error(message:string,fields?:Record<string,unknown>):void}

export interface DeploymentVerificationRequest{
 releaseCandidateId:string;certificationRunId:string;environment:'STAGING'|'PRODUCTION'|'DISASTER_RECOVERY';
 phase:'CANARY'|'POST_DEPLOYMENT';deployedArtifactManifestSha256:string;deployedMigrationManifestSha256:string;
 readinessComponentId:string;verificationPayload:Record<string,unknown>;requestId:string;correlationId:string;
}

export interface RollbackCertificationRequest{
 certificationRunId:string;environment:'TEST'|'STAGING'|'DISASTER_RECOVERY';
 rollbackManifestSha256:string;executionEvidence:Record<string,unknown>;
 requestId:string;correlationId:string;
}
