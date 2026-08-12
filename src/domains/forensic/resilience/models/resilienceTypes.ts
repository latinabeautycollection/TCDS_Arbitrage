export type Uuid = string;
export interface ForensicPrincipal {
  readonly tenantKey: string;
  readonly userId: Uuid;
  readonly authSessionId: Uuid;
  readonly deviceId?: Uuid;
  readonly assuranceLevel: 'AAL1' | 'AAL2';
  readonly permissions: readonly string[];
}
export interface ExecutionContext {
  readonly processRunId: Uuid;
  readonly processStepId: number;
  readonly correlationId: Uuid;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface BackupRequest {
  readonly policyCode: string;
  readonly sourceDatabaseReference: string;
  readonly primaryObjectKey: string;
  readonly secondaryObjectKey: string;
  readonly idempotencyKey: string;
}
export interface EncryptedBackup {
  readonly encryptedPath: string;
  readonly encryptedSha256: string;
  readonly encryptedBytes: number;
  readonly keyId: string;
  readonly keyVersion: string;
  readonly encryptedDataKey: string;
  readonly ivHex: string;
  readonly authTagHex: string;
}
export interface RestorePlanInput {
  readonly backupExecutionId: Uuid;
  readonly recoveryNamespace: string;
  readonly recoveryDatabaseUrl: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}
