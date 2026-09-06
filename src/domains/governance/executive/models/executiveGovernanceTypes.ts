export type ExecutiveGovernanceState = 'GREEN'|'GUARDED'|'DEGRADED'|'RESTRICTED'|'BLOCKED'|'UNKNOWN';
export type CertificationOutcome = 'PENDING'|'CERTIFIED_COMPLETE'|'CERTIFIED_WITH_RESTRICTIONS'|'NOT_CERTIFIED'|'BLOCKED';
export type CertificationValidity = CertificationOutcome|'REVOKED'|'SUPERSEDED'|'REVALIDATION_REQUIRED';
export type ActorType = 'USER'|'SERVICE'|'SYSTEM';
export interface TrustedActor { type: ActorType; id: string; permissions: ReadonlySet<string>; }
export interface CurrentCertificationValidity {
  currentValidity: CertificationValidity|string;
  reasonCode: string;
  consumable: boolean;
  certificationId: string|null;
  epochId: string|null;
  epochCode: string|null;
  activeReleaseIdentity: string|null;
  releaseCertificationId: string|null;
  certificationEnvironment: string|null;
}
export interface ExecutiveSummary {
  snapshotId: string|null; generatedAt: string|null;
  executiveStateAtSnapshot: ExecutiveGovernanceState;
  currentExecutiveGovernanceState: ExecutiveGovernanceState;
  phase3CertificationStateAtSnapshot: string;
  currentPhase3CertificationValidity: string;
  currentPhase3CertificationReason: string;
  currentPhase3EpochId: string|null;
  currentPhase3EpochCode: string|null;
  currentPhase3Consumable: boolean;
  activeReleaseIdentity: string|null; healthState: string; readinessState: string;
  policyState: string; capitalSafetyState: string; kpiTrustState: string; profitabilityState: string;
  reliabilityState: string; controlRequiredState: string; controlEnforcementState: string;
  unresolvedCriticalConditions: readonly unknown[];
}
export interface CertificationRequest {
  idempotencyKey: string; evidenceCutoffAt: string; policyReference: string; policySha256: string;
  activeReleaseIdentity: string; activeReleaseManifestSha256: string; sourceRevision: string;
  sourceManifestSha256: string; migrationBaseline: string; migrationManifestSha256: string;
  policyManifestSha256: string; configurationBaselineSha256?: string; orchestratorVersion: string; suiteVersion: string;
  certificationEnvironment: 'PRODUCTION_EQUIVALENT'; certificationEnvironmentSha256: string;
}
export interface CertificationResult { outcome: string; phase3CertificationId: string|null; epochId: string|null; epochCode: string|null; reasonCodes: readonly string[]; }
export interface RevocationRequest { reasonCode: string; evidenceReference: string; evidenceSha256: string; correlationId: string; }

export interface SnapshotRequest { idempotencyKey: string; evidenceCutoffAt: string; }
