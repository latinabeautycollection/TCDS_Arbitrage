import type { Pool } from "pg";
import { DOMAIN11B_PROBE, DOMAIN11B_PUSH } from "../constants/healthConstants";
import { ComponentHealthAggregationEngine } from "../engines/componentHealthAggregationEngine";
import { HealthClassificationEngine } from "../engines/healthClassificationEngine";
import type { AuthenticatedHealthPrincipal, HealthCheckDefinition, HealthProbeResult, PushHealthSignal } from "../models/healthTypes";
import type { HealthLogger } from "../observability/healthLogger";
import type { HealthMetrics } from "../observability/healthMetrics";
import { HealthObservationRepository } from "../repositories/healthObservationRepository";
import { HealthRegistryRepository } from "../repositories/healthRegistryRepository";

export class HealthObservationService {
  constructor(
    private readonly pool: Pool,
    private readonly registry: HealthRegistryRepository,
    private readonly observations: HealthObservationRepository,
    private readonly classifier = new HealthClassificationEngine(),
    private readonly aggregator = new ComponentHealthAggregationEngine(),
    private readonly metrics: HealthMetrics,
    private readonly logger: HealthLogger,
  ) {}

  async recordProbeResult(definition: HealthCheckDefinition, sourceEventId: string, result: HealthProbeResult, correlationId?: string): Promise<void> {
    await this.record(definition.id, definition.componentId, "PULL", sourceEventId, result, DOMAIN11B_PROBE, correlationId);
  }

  async recordPushSignal(signal: PushHealthSignal, principal: AuthenticatedHealthPrincipal, correlationId?: string): Promise<void> {
    await this.record(signal.definitionId, signal.componentId, "PUSH", signal.sourceEventId,
      { outcome: signal.outcome, latencyMs: signal.latencyMs, evidence: signal.evidence }, DOMAIN11B_PUSH, correlationId, signal.observedAt, principal);
  }

  private async record(
    definitionId: string,
    componentId: string,
    sourceKind: "PULL" | "PUSH",
    sourceEventId: string,
    result: HealthProbeResult,
    producer: string,
    correlationId?: string,
    observedAt = new Date(),
    principal?: AuthenticatedHealthPrincipal,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.observations.lockComponent(client, componentId);
      const definition = await this.registry.getDefinition(client, definitionId, componentId);
      if (sourceKind === "PUSH" && definition.mode !== "PUSH") throw new Error("PUSH signal may only target an active PUSH health definition");
      if (sourceKind === "PULL" && definition.mode !== "PULL") throw new Error("PULL result may only target an active PULL health definition");
      const runtime = await this.observations.loadRuntime(client, definitionId, componentId);
      const authority = sourceKind === "PUSH" && principal
        ? await this.observations.authorizePush(client, definitionId, componentId, principal)
        : undefined;
      if (sourceKind === "PUSH" && !principal) throw new Error("PUSH signal requires authenticated provenance");

      const classified = this.classifier.classify(definition, runtime, result, observedAt);
      const provenance = principal ? { principal, authority } : undefined;
      const persisted = await this.observations.insertCheckObservation(
        client, definition, classified, sourceKind, sourceEventId, producer, correlationId, provenance,
      );
      if (!persisted.inserted) {
        await client.query("COMMIT");
        return;
      }
      await this.observations.linkObservation(client, definition, persisted.id, sourceKind, provenance);

      const lastAccepted = runtime.lastAcceptedObservedAt;
      const staleOrEqual = Boolean(lastAccepted && observedAt.getTime() <= lastAccepted.getTime());
      if (staleOrEqual) {
        this.logger.warn("domain11b.health.out_of_order_evidence_preserved", { definitionId, componentId, sourceEventId, observedAt: observedAt.toISOString(), lastAcceptedObservedAt: lastAccepted?.toISOString() });
        await client.query("COMMIT");
        return;
      }

      await this.observations.updateRuntime(client, definition, classified, persisted.id, sourceEventId);
      const snapshots = await this.observations.loadActiveCheckSnapshots(client, componentId);
      const aggregate = this.aggregator.aggregate(componentId, snapshots, new Date());
      const aggregateResult = await this.observations.persistAggregate(client, aggregate, correlationId);
      if (aggregateResult.changed) this.metrics.aggregationChanged(componentId, aggregate.healthState);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (sourceKind === "PUSH") this.metrics.ingestRejected(error instanceof Error ? error.name : "UnknownError");
      throw error;
    } finally { client.release(); }
  }
}
