import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  ActiveCheckSnapshot,
  AuthenticatedHealthPrincipal,
  ClassifiedHealthResult,
  ComponentHealthAggregate,
  HealthCheckDefinition,
  HealthCheckRuntime,
  PushAuthorityMatch,
} from "../models/healthTypes";

export class HealthObservationRepository {
  async lockComponent(client: PoolClient, componentId: string): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [componentId]);
  }

  async loadRuntime(client: PoolClient, definitionId: string, componentId: string): Promise<HealthCheckRuntime> {
    const r = await client.query(`SELECT * FROM arb.health_check_runtime
      WHERE health_check_definition_id=$1 AND component_id=$2 FOR UPDATE`, [definitionId, componentId]);
    if (!r.rowCount) throw new Error("Health runtime state missing; activate the definition first");
    const x = r.rows[0] as Record<string, unknown>;
    return {
      definitionId,
      componentId,
      consecutiveSuccesses: Number(x.consecutive_successes),
      consecutiveFailures: Number(x.consecutive_failures),
      lastOutcome: x.last_outcome ? String(x.last_outcome) as HealthCheckRuntime["lastOutcome"] : undefined,
      lastHealthState: x.last_health_state ? String(x.last_health_state) as HealthCheckRuntime["lastHealthState"] : undefined,
      lastAcceptedObservedAt: x.last_accepted_observed_at ? new Date(String(x.last_accepted_observed_at)) : undefined,
      lastAcceptedSourceEventId: x.last_accepted_source_event_id ? String(x.last_accepted_source_event_id) : undefined,
    };
  }

  async authorizePush(
    client: PoolClient,
    definitionId: string,
    componentId: string,
    principal: AuthenticatedHealthPrincipal,
  ): Promise<PushAuthorityMatch> {
    const r = await client.query<{ authority_id: string; producer_component_id: string | null }>(`
      SELECT a.authority_id, a.producer_component_id
      FROM arb.health_push_authorities a
      LEFT JOIN arb.health_push_authority_revocations rv ON rv.authority_id=a.authority_id
      WHERE a.health_check_definition_id=$1
        AND a.component_id=$2
        AND a.principal_id=$3
        AND ((a.producer_component_id IS NULL AND $4::uuid IS NULL) OR a.producer_component_id=$4::uuid)
        AND a.effective_from <= clock_timestamp()
        AND (a.effective_until IS NULL OR a.effective_until > clock_timestamp())
        AND rv.authority_id IS NULL
      ORDER BY a.effective_from DESC
      LIMIT 1`, [definitionId, componentId, principal.principalId, principal.producerComponentId ?? null]);
    if (!r.rowCount) throw new Error("Authenticated principal is not authorized to publish this health definition");
    const row = r.rows[0];
    if (!row) throw new Error("Push authority lookup returned no row");
    return { authorityId: row.authority_id, producerComponentId: row.producer_component_id ?? undefined };
  }

  async insertCheckObservation(
    client: PoolClient,
    definition: HealthCheckDefinition,
    classified: ClassifiedHealthResult,
    sourceKind: "PULL" | "PUSH" | "SYNTHETIC",
    sourceEventId: string,
    producer: string,
    correlationId?: string,
    provenance?: { principal?: AuthenticatedHealthPrincipal; authority?: PushAuthorityMatch },
  ): Promise<{ id: string; inserted: boolean }> {
    const id = randomUUID();
    const evidence = {
      ...classified.evidence,
      errorCode: classified.errorCode ?? null,
      provenance: provenance?.principal ? {
        authenticatedPrincipal: provenance.principal.principalId,
        producerComponentId: provenance.principal.producerComponentId ?? null,
        pushAuthorityId: provenance.authority?.authorityId ?? null,
      } : undefined,
    };
    const result = await client.query<{ health_observation_id: string }>(`
      INSERT INTO arb.health_observations
       (health_observation_id,component_id,health_state,source_kind,source_event_id,observed_at,expires_at,latency_ms,evidence,correlation_id,producer)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
      ON CONFLICT (component_id,source_kind,source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING
      RETURNING health_observation_id`, [id, definition.componentId, classified.healthState, sourceKind, sourceEventId,
      classified.observedAt, classified.expiresAt, classified.latencyMs ?? null, JSON.stringify(evidence), correlationId ?? null, producer]);
    const first = result.rows[0];
    if (first) return { id: first.health_observation_id, inserted: true };
    const existing = await client.query<{ health_observation_id: string }>(`SELECT health_observation_id FROM arb.health_observations
      WHERE component_id=$1 AND source_kind=$2 AND source_event_id=$3`, [definition.componentId, sourceKind, sourceEventId]);
    const existingRow = existing.rows[0];
    if (!existingRow) throw new Error("Health observation idempotency lookup failed");
    return { id: existingRow.health_observation_id, inserted: false };
  }

  async linkObservation(
    client: PoolClient,
    definition: HealthCheckDefinition,
    observationId: string,
    sourceKind: "PULL" | "PUSH" | "SYNTHETIC",
    provenance?: { principal?: AuthenticatedHealthPrincipal; authority?: PushAuthorityMatch },
  ): Promise<void> {
    await client.query(`INSERT INTO arb.health_check_observation_links
      (health_check_definition_id,component_id,health_observation_id,ingest_kind,authenticated_principal,producer_component_id,push_authority_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [
      definition.id, definition.componentId, observationId, sourceKind,
      provenance?.principal?.principalId ?? null,
      provenance?.principal?.producerComponentId ?? null,
      provenance?.authority?.authorityId ?? null,
    ]);
  }

  async updateRuntime(client: PoolClient, definition: HealthCheckDefinition, classified: ClassifiedHealthResult, observationId: string, sourceEventId: string): Promise<void> {
    const jitter = definition.jitterSeconds > 0 ? Math.floor(Math.random() * (definition.jitterSeconds + 1)) : 0;
    const nextSeconds = (definition.intervalSeconds ?? Math.max(5, Math.floor(definition.observationTtlSeconds / 2))) + jitter;
    await client.query(`UPDATE arb.health_check_runtime SET
      lease_owner=NULL,lease_until=NULL,consecutive_successes=$3,consecutive_failures=$4,last_outcome=$5,last_health_state=$6,
      last_health_observation_id=$7,last_accepted_observed_at=$8,last_accepted_source_event_id=$9,
      last_completed_at=clock_timestamp(),last_error_code=$10,next_due_at=clock_timestamp()+make_interval(secs=>$11),updated_at=clock_timestamp()
      WHERE health_check_definition_id=$1 AND component_id=$2`, [definition.id, definition.componentId, classified.consecutiveSuccesses,
      classified.consecutiveFailures, classified.outcome, classified.healthState, observationId, classified.observedAt, sourceEventId,
      classified.errorCode ?? null, nextSeconds]);
  }

  async releaseLease(client: PoolClient, definitionId: string, componentId: string, retrySeconds = 15, errorCode = "HEALTH_CLAIM_FAILED"): Promise<void> {
    await client.query(`UPDATE arb.health_check_runtime
      SET lease_owner=NULL, lease_until=NULL, next_due_at=clock_timestamp()+make_interval(secs=>$3), last_error_code=$4, updated_at=clock_timestamp()
      WHERE health_check_definition_id=$1 AND component_id=$2`, [definitionId, componentId, retrySeconds, errorCode]);
  }

  async loadActiveCheckSnapshots(client: PoolClient, componentId: string): Promise<ActiveCheckSnapshot[]> {
    const result = await client.query(`
      SELECT d.*,
        o.health_state AS latest_state,o.observed_at AS latest_observed_at,o.expires_at AS latest_expires_at
      FROM arb.health_check_active a
      JOIN arb.health_check_definitions d ON d.health_check_definition_id=a.health_check_definition_id
      LEFT JOIN LATERAL (
        SELECT ho.health_state,ho.observed_at,ho.expires_at
        FROM arb.health_check_observation_links l
        JOIN arb.health_observations ho ON ho.health_observation_id=l.health_observation_id
        WHERE l.health_check_definition_id=d.health_check_definition_id
        ORDER BY ho.observed_at DESC,ho.received_at DESC LIMIT 1
      ) o ON true
      WHERE a.component_id=$1 ORDER BY d.check_code`, [componentId]);
    return result.rows.map((r: Record<string, unknown>) => ({
      definition: {
        id: String(r.health_check_definition_id), componentId: String(r.component_id), checkCode: String(r.check_code), version: Number(r.version),
        mode: String(r.check_mode) as HealthCheckDefinition["mode"], kind: String(r.check_kind) as HealthCheckDefinition["kind"],
        successState: String(r.success_state) as HealthCheckDefinition["successState"], requiredForComponentHealth: Boolean(r.required_for_component_health),
        degradesComponentHealth: Boolean(r.degrades_component_health), intervalSeconds: r.interval_seconds == null ? undefined : Number(r.interval_seconds),
        timeoutMs: r.timeout_ms == null ? undefined : Number(r.timeout_ms), observationTtlSeconds: Number(r.observation_ttl_seconds),
        failureThreshold: Number(r.failure_threshold), recoveryThreshold: Number(r.recovery_threshold), jitterSeconds: Number(r.jitter_seconds),
        configuration: (r.configuration ?? {}) as Record<string, unknown>, secretReference: r.secret_reference == null ? undefined : String(r.secret_reference),
      },
      latestState: r.latest_state == null ? undefined : String(r.latest_state) as ActiveCheckSnapshot["latestState"],
      observedAt: r.latest_observed_at ? new Date(String(r.latest_observed_at)) : undefined,
      expiresAt: r.latest_expires_at ? new Date(String(r.latest_expires_at)) : undefined,
    }));
  }

  async persistAggregate(client: PoolClient, aggregate: ComponentHealthAggregate, correlationId?: string): Promise<{ observationId: string; changed: boolean }> {
    const previous = await client.query<{ health_state: string }>(
      `SELECT health_state FROM arb.health_state_current WHERE component_id=$1 FOR UPDATE`, [aggregate.componentId]);
    const previousState = previous.rows[0]?.health_state ?? null;
    const observationId = randomUUID();
    await client.query(`INSERT INTO arb.health_observations
      (health_observation_id,component_id,health_state,source_kind,source_event_id,observed_at,expires_at,evidence,correlation_id,producer)
      VALUES($1,$2,$3,'SYNTHETIC',$4,$5,$6,$7::jsonb,$8,'DOMAIN11B_AGGREGATOR')`, [observationId, aggregate.componentId, aggregate.healthState,
      `aggregate:${observationId}`, aggregate.observedAt, aggregate.expiresAt, JSON.stringify(aggregate.evidence), correlationId ?? null]);
    await client.query(`INSERT INTO arb.health_state_current
      (component_id,health_observation_id,health_state,effective_at,expires_at,updated_at)
      VALUES($1,$2,$3,$4,$5,clock_timestamp())
      ON CONFLICT (component_id) DO UPDATE SET health_observation_id=EXCLUDED.health_observation_id,
        health_state=EXCLUDED.health_state,effective_at=EXCLUDED.effective_at,expires_at=EXCLUDED.expires_at,updated_at=clock_timestamp()`,
      [aggregate.componentId, observationId, aggregate.healthState, aggregate.observedAt, aggregate.expiresAt]);

    const changed = previousState !== aggregate.healthState;
    if (changed) {
      const eventId = randomUUID();
      const idempotencyKey = `health-state:${aggregate.componentId}:${observationId}`;
      await client.query(`INSERT INTO arb.domain_events
        (domain_event_id,event_type,aggregate_type,aggregate_id,payload,correlation_id,idempotency_key,occurred_at)
        VALUES($1,'DOMAIN11.HEALTH_STATE_CHANGED','COMPONENT',$2,$3::jsonb,$4,$5,$6)`,
        [eventId, aggregate.componentId, JSON.stringify({ previousState, newState: aggregate.healthState }), correlationId ?? null, idempotencyKey, aggregate.observedAt]);
      await client.query(`INSERT INTO arb.outbox_events(domain_event_id,topic,status,available_at)
        VALUES($1,'domain11.health','PENDING',clock_timestamp())`, [eventId]);
    }
    return { observationId, changed };
  }

  async findComponentsNeedingReconciliation(client: PoolClient, limit: number): Promise<string[]> {
    const r = await client.query<{ component_id: string }>(`
      SELECT DISTINCT component_id
      FROM (
        SELECT hs.component_id
        FROM arb.health_state_current hs
        WHERE hs.expires_at IS NULL OR hs.expires_at <= clock_timestamp()
        UNION ALL
        SELECT a.component_id
        FROM arb.health_check_active a
        JOIN arb.health_check_definitions d ON d.health_check_definition_id=a.health_check_definition_id
        LEFT JOIN LATERAL (
          SELECT ho.expires_at
          FROM arb.health_check_observation_links l
          JOIN arb.health_observations ho ON ho.health_observation_id=l.health_observation_id
          WHERE l.health_check_definition_id=d.health_check_definition_id
          ORDER BY ho.observed_at DESC,ho.received_at DESC LIMIT 1
        ) latest ON true
        WHERE (d.required_for_component_health OR d.degrades_component_health)
          AND (latest.expires_at IS NULL OR latest.expires_at <= clock_timestamp())
      ) x
      ORDER BY component_id
      LIMIT $1`, [limit]);
    return r.rows.map((row) => row.component_id);
  }
}
