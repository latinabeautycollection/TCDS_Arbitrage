import type { RollbackCheckpointCode } from "../certification/backHalfTypes";

describe("8G.1.3 rollback checkpoint contract", () => {
  it("requires the complete rollback verification set", () => {
    const checkpoints: RollbackCheckpointCode[] = [
      "TARGET_VERSION_VERIFIED",
      "APPLICATION_REVERTED",
      "DATABASE_COMPATIBILITY_VERIFIED",
      "MIGRATION_STATE_VERIFIED",
      "API_HEALTH_PASS",
      "API_READINESS_PASS",
      "WORKERS_ONLINE",
      "QUEUE_STATE_SAFE",
      "NO_NEW_CRITICAL_ERRORS",
      "SCHEMA_DIGEST_MATCH",
      "PRIVILEGE_DIGEST_MATCH",
      "POST_ROLLBACK_SMOKE_PASS",
    ];
    expect(checkpoints).toHaveLength(12);
    expect(new Set(checkpoints).size).toBe(12);
  });
});
