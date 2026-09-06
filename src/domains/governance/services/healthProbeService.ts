import { randomUUID } from "node:crypto";
import type { HealthWorkerConfig } from "../config/healthEnv";
import type { HealthCheckDefinition, HealthProbeResult } from "../models/healthTypes";
import type { HealthLogger } from "../observability/healthLogger";
import type { HealthMetrics } from "../observability/healthMetrics";
import { HealthProbeAdapterRegistry } from "../providers/health/HealthProbeAdapterRegistry";
import { HealthRegistryRepository } from "../repositories/healthRegistryRepository";
import { HealthObservationService } from "./healthObservationService";

export class HealthProbeService {
  constructor(
    private readonly config: HealthWorkerConfig,
    private readonly registry: HealthRegistryRepository,
    private readonly adapters: HealthProbeAdapterRegistry,
    private readonly observations: HealthObservationService,
    private readonly metrics: HealthMetrics,
    private readonly logger: HealthLogger,
  ) {}

  async runDueBatch(): Promise<number> {
    const claims = await this.registry.claimDuePullChecks(this.config.workerId, this.config.claimLimit, this.config.leaseSeconds);
    this.metrics.probeClaimed(claims.length);
    let cursor = 0;
    const concurrency = Math.min(this.config.maxConcurrentChecks, claims.length);
    const workers = Array.from({ length: concurrency }, async () => {
      for (;;) {
        const index = cursor++;
        const claim = claims[index];
        if (!claim) return;
        try {
          await this.executeClaim(claim.definition);
        } catch (error) {
          this.metrics.claimError(claim.definition.kind);
          this.logger.error("domain11b.health.claim_failed", { definitionId: claim.definition.id, componentId: claim.definition.componentId, errorName: error instanceof Error ? error.name : "UnknownError" });
          try { await this.registry.releaseClaim(claim.definition.id, claim.definition.componentId, "HEALTH_CLAIM_FAILED"); }
          catch (releaseError) { this.logger.error("domain11b.health.claim_release_failed", { definitionId: claim.definition.id, errorName: releaseError instanceof Error ? releaseError.name : "UnknownError" }); }
        }
      }
    });
    await Promise.all(workers);
    return claims.length;
  }

  private async executeClaim(definition: HealthCheckDefinition): Promise<void> {
    const sourceEventId = `pull:${definition.id}:${randomUUID()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), definition.timeoutMs ?? 5000);
    (timeout as { unref?: () => void }).unref?.();
    let result: HealthProbeResult;
    try {
      const adapter = this.adapters.get(definition.kind);
      result = await adapter.execute(definition, { signal: controller.signal });
    } catch (error) {
      result = { outcome: "FAILURE", evidence: { errorName: error instanceof Error ? error.name : "UnknownError" }, errorCode: "HEALTH_ADAPTER_EXECUTION_FAILED" };
    } finally { clearTimeout(timeout); }
    this.metrics.probeCompleted(definition.kind, result.outcome, result.latencyMs);
    await this.observations.recordProbeResult(definition, sourceEventId, result);
  }
}
