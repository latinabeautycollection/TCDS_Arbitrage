import type { Pool } from "pg";
import { ComponentHealthAggregationEngine } from "../engines/componentHealthAggregationEngine";
import type { HealthLogger } from "../observability/healthLogger";
import type { HealthMetrics } from "../observability/healthMetrics";
import { HealthObservationRepository } from "../repositories/healthObservationRepository";

export class HealthExpiryReconciliationService {
  constructor(
    private readonly pool: Pool,
    private readonly observations: HealthObservationRepository,
    private readonly aggregator: ComponentHealthAggregationEngine,
    private readonly metrics: HealthMetrics,
    private readonly logger: HealthLogger,
  ) {}

  async reconcile(limit: number): Promise<number> {
    const discovery = await this.pool.connect();
    let componentIds: string[] = [];
    try { componentIds = await this.observations.findComponentsNeedingReconciliation(discovery, limit); }
    finally { discovery.release(); }

    let reconciled = 0;
    for (const componentId of componentIds) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await this.observations.lockComponent(client, componentId);
        const checks = await this.observations.loadActiveCheckSnapshots(client, componentId);
        const aggregate = this.aggregator.aggregate(componentId, checks, new Date());
        const result = await this.observations.persistAggregate(client, aggregate);
        if (result.changed) this.metrics.aggregationChanged(componentId, aggregate.healthState);
        await client.query("COMMIT");
        reconciled += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        this.logger.error("domain11b.health.expiry_reconciliation_failed", { componentId, errorName: error instanceof Error ? error.name : "UnknownError" });
      } finally { client.release(); }
    }
    if (reconciled) this.metrics.expiredReconciled(reconciled);
    return reconciled;
  }
}
