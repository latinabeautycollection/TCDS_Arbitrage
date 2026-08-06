export type Uuid = string;
export interface ForensicPrincipal {
  readonly tenantKey: string;
  readonly userId: Uuid;
  readonly authSessionId: Uuid;
  readonly assuranceLevel: 'AAL1' | 'AAL2';
  readonly permissions: readonly string[];
}
export interface StartCertificationInput {
  readonly releaseCode: 'DOMAIN7_COMPLETE_R5';
  readonly sourceCommit: string;
  readonly environment: string;
  readonly buildArtifactSha256: string;
  readonly idempotencyKey: string;
  readonly processRunId: Uuid;
}
export interface InstallationCertificateInput {
  readonly databaseName: string;
  readonly serverVersion: string;
  readonly migrationManifest: Readonly<Record<string, unknown>>;
  readonly buildReport: Readonly<Record<string, unknown>>;
  readonly smokeReport: Readonly<Record<string, unknown>>;
  readonly routeReport: Readonly<Record<string, unknown>>;
  readonly workerReport: Readonly<Record<string, unknown>>;
  readonly queueReport: Readonly<Record<string, unknown>>;
  readonly cloneFingerprint: string;
}
