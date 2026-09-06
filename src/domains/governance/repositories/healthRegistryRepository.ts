import type { Pool, PoolClient } from "pg";
import type { ComponentRegistrationInput, DependencyRegistrationInput, HealthCheckDefinition, HealthCheckRuntime } from "../models/healthTypes";

export interface ClaimedHealthCheck { definition: HealthCheckDefinition; runtime: HealthCheckRuntime; }

function mapDefinition(r: Record<string, any>): HealthCheckDefinition {
  return {
    id: r.health_check_definition_id,
    componentId: r.component_id,
    checkCode: r.check_code,
    version: r.version,
    mode: r.check_mode,
    kind: r.check_kind,
    successState: r.success_state,
    requiredForComponentHealth: r.required_for_component_health,
    degradesComponentHealth: r.degrades_component_health,
    intervalSeconds: r.interval_seconds ?? undefined,
    timeoutMs: r.timeout_ms ?? undefined,
    observationTtlSeconds: r.observation_ttl_seconds,
    failureThreshold: r.failure_threshold,
    recoveryThreshold: r.recovery_threshold,
    jitterSeconds: r.jitter_seconds,
    configuration: r.configuration ?? {},
    secretReference: r.secret_reference ?? undefined,
  };
}

export class HealthRegistryRepository {
  constructor(private readonly pool: Pool) {}

  async registerComponent(input: ComponentRegistrationInput): Promise<string> {
    const result = await this.pool.query<{ component_id: string }>(`
      INSERT INTO arb.component_registry
        (domain_id,component_code,component_name,component_type,authoritative_system,criticality,mutation_authority,metadata)
      SELECT d.domain_id,$2,$3,$4,$5,$6,$7,$8::jsonb
      FROM arb.domain_registry d WHERE d.domain_code=$1
      ON CONFLICT (domain_id,component_code) DO UPDATE SET
        component_name=EXCLUDED.component_name,
        component_type=EXCLUDED.component_type,
        authoritative_system=EXCLUDED.authoritative_system,
        criticality=EXCLUDED.criticality,
        mutation_authority=EXCLUDED.mutation_authority,
        metadata=EXCLUDED.metadata,
        active=true
      RETURNING component_id`, [
      input.domainCode,input.componentCode,input.componentName,input.componentType,input.authoritativeSystem,input.criticality,
      input.mutationAuthority ?? false, JSON.stringify(input.metadata ?? {}),
    ]);
    if (!result.rowCount) throw new Error(`Unknown domain ${input.domainCode}`);
    const row = result.rows[0];
    if (!row) throw new Error("Component registration returned no row");
    return row.component_id;
  }

  async registerDependency(input: DependencyRegistrationInput): Promise<string> {
    const result = await this.pool.query<{ dependency_id: string }>(`
      INSERT INTO arb.dependency_registry
       (consumer_component_id,provider_component_id,external_dependency_code,dependency_kind,
        required_for_readiness,required_for_mutation,required_for_external_side_effect,max_staleness_seconds,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
      RETURNING dependency_id`, [input.consumerComponentId,input.providerComponentId ?? null,input.externalDependencyCode ?? null,
      input.dependencyKind,input.requiredForReadiness,input.requiredForMutation,input.requiredForExternalSideEffect,
      input.maxStalenessSeconds ?? null,JSON.stringify(input.metadata ?? {})]);
    const row = result.rows[0];
    if (!row) throw new Error("Dependency registration returned no row");
    return row.dependency_id;
  }

  async createDefinition(definition: Omit<HealthCheckDefinition, "id">): Promise<string> {
    const result = await this.pool.query<{ health_check_definition_id: string }>(`
      INSERT INTO arb.health_check_definitions
       (component_id,check_code,version,check_mode,check_kind,success_state,required_for_component_health,
        degrades_component_health,interval_seconds,timeout_ms,observation_ttl_seconds,failure_threshold,recovery_threshold,
        jitter_seconds,configuration,secret_reference)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
      RETURNING health_check_definition_id`, [definition.componentId,definition.checkCode,definition.version,definition.mode,
      definition.kind,definition.successState,definition.requiredForComponentHealth,definition.degradesComponentHealth,
      definition.intervalSeconds ?? null,definition.timeoutMs ?? null,definition.observationTtlSeconds,definition.failureThreshold,
      definition.recoveryThreshold,definition.jitterSeconds,JSON.stringify(definition.configuration),definition.secretReference ?? null]);
    const row = result.rows[0];
    if (!row) throw new Error("Health definition insert returned no row");
    return row.health_check_definition_id;
  }

  async activateDefinition(componentId: string, checkCode: string, definitionId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        INSERT INTO arb.health_check_active(component_id,check_code,health_check_definition_id)
        VALUES($1,$2,$3)
        ON CONFLICT (component_id,check_code) DO UPDATE SET
          health_check_definition_id=EXCLUDED.health_check_definition_id,
          activated_at=clock_timestamp(),activated_by=session_user`, [componentId,checkCode,definitionId]);
      await client.query(`
        INSERT INTO arb.health_check_runtime(health_check_definition_id,component_id,next_due_at)
        VALUES($1,$2,clock_timestamp()) ON CONFLICT (health_check_definition_id) DO NOTHING`, [definitionId,componentId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async bindDependency(definitionId: string, componentId: string, dependencyId: string, role: "PRIMARY" | "SUPPORTING" = "PRIMARY"): Promise<void> {
    await this.pool.query(`INSERT INTO arb.health_check_dependency_bindings
      (health_check_definition_id,component_id,dependency_id,binding_role) VALUES($1,$2,$3,$4)`, [definitionId,componentId,dependencyId,role]);
  }

  async claimDuePullChecks(workerId: string, limit: number, leaseSeconds: number): Promise<ClaimedHealthCheck[]> {
    const result = await this.pool.query(`
      WITH candidates AS (
        SELECT r.health_check_definition_id
        FROM arb.health_check_runtime r
        JOIN arb.health_check_active a ON a.health_check_definition_id=r.health_check_definition_id
        JOIN arb.health_check_definitions d ON d.health_check_definition_id=r.health_check_definition_id
        JOIN arb.component_registry c ON c.component_id=d.component_id
        WHERE d.check_mode='PULL' AND c.active
          AND r.next_due_at <= clock_timestamp()
          AND (r.lease_until IS NULL OR r.lease_until < clock_timestamp())
        ORDER BY r.next_due_at, d.health_check_definition_id
        FOR UPDATE OF r SKIP LOCKED
        LIMIT $2
      )
      UPDATE arb.health_check_runtime r
      SET lease_owner=$1, lease_until=clock_timestamp()+make_interval(secs=>$3), last_started_at=clock_timestamp(), updated_at=clock_timestamp()
      FROM candidates c, arb.health_check_definitions d
      WHERE r.health_check_definition_id=c.health_check_definition_id
        AND d.health_check_definition_id=r.health_check_definition_id
      RETURNING d.*, r.consecutive_successes, r.consecutive_failures, r.last_outcome, r.last_health_state`, [workerId,limit,leaseSeconds]);
    return result.rows.map((r: any) => ({
      definition: mapDefinition(r),
      runtime: {
        definitionId:r.health_check_definition_id, componentId:r.component_id,
        consecutiveSuccesses:r.consecutive_successes, consecutiveFailures:r.consecutive_failures,
        lastOutcome:r.last_outcome ?? undefined,lastHealthState:r.last_health_state ?? undefined,
      },
    }));
  }

  async getDefinition(client: PoolClient, definitionId: string, componentId: string): Promise<HealthCheckDefinition> {
    const result = await client.query(`SELECT d.* FROM arb.health_check_definitions d
      JOIN arb.health_check_active a ON a.health_check_definition_id=d.health_check_definition_id
      WHERE d.health_check_definition_id=$1 AND d.component_id=$2`, [definitionId,componentId]);
    if (!result.rowCount) throw new Error("Health definition is not active for component");
    return mapDefinition(result.rows[0]);
  }
  async releaseClaim(definitionId: string, componentId: string, errorCode: string): Promise<void> {
    await this.pool.query(`UPDATE arb.health_check_runtime
      SET lease_owner=NULL, lease_until=NULL, next_due_at=clock_timestamp()+interval '15 seconds', last_error_code=$3, updated_at=clock_timestamp()
      WHERE health_check_definition_id=$1 AND component_id=$2`, [definitionId,componentId,errorCode]);
  }

  async authorizePushPrincipal(definitionId: string, componentId: string, principalId: string, producerComponentId?: string): Promise<string> {
    const result = await this.pool.query<{ authority_id: string }>(`INSERT INTO arb.health_push_authorities
      (health_check_definition_id,component_id,principal_id,producer_component_id) VALUES($1,$2,$3,$4) RETURNING authority_id`,
      [definitionId,componentId,principalId,producerComponentId ?? null]);
    const row = result.rows[0]; if (!row) throw new Error("Push authority insert failed"); return row.authority_id;
  }

  async revokePushAuthority(authorityId: string, reason: string): Promise<void> {
    await this.pool.query(`INSERT INTO arb.health_push_authority_revocations(authority_id,reason) VALUES($1,$2)`, [authorityId,reason]);
  }

}
