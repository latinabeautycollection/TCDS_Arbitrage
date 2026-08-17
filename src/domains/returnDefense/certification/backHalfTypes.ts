export type RollbackCheckpointCode =
  | "TARGET_VERSION_VERIFIED"
  | "APPLICATION_REVERTED"
  | "DATABASE_COMPATIBILITY_VERIFIED"
  | "MIGRATION_STATE_VERIFIED"
  | "API_HEALTH_PASS"
  | "API_READINESS_PASS"
  | "WORKERS_ONLINE"
  | "QUEUE_STATE_SAFE"
  | "NO_NEW_CRITICAL_ERRORS"
  | "SCHEMA_DIGEST_MATCH"
  | "PRIVILEGE_DIGEST_MATCH"
  | "POST_ROLLBACK_SMOKE_PASS";

export interface RollbackCheckpointResult {
  rollbackRunId: string;
  checkpointCode: RollbackCheckpointCode;
  status: "PASS" | "FAIL";
  actualResult: Record<string, unknown>;
  evidenceDigest: string;
  evidenceLocation: string;
}

export interface PostReleaseChecks {
  api_health_pass: boolean;
  api_readiness_pass: boolean;
  worker_health_pass: boolean;
  queue_health_pass: boolean;
  data_integrity_pass: boolean;
  security_regression_pass: boolean;
  financial_reconciliation_pass: boolean;
  [key: string]: unknown;
}
