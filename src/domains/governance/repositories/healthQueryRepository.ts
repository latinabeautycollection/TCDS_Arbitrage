import type { Pool } from "pg";
export class HealthQueryRepository {
  constructor(private readonly pool: Pool) {}
  async listRegistry() {
    const r=await this.pool.query(`SELECT * FROM arb.v_enterprise_health_registry ORDER BY domain_code,component_code,check_code NULLS LAST`);
    return r.rows;
  }
  async getComponentHealth(componentId: string) {
    const r=await this.pool.query(`SELECT c.component_id,c.component_code,c.component_name,d.domain_code,
      hs.health_state,hs.effective_at,hs.expires_at,ho.evidence,ho.evidence_sha256
      FROM arb.component_registry c
      JOIN arb.domain_registry d ON d.domain_id=c.domain_id
      LEFT JOIN arb.health_state_current hs ON hs.component_id=c.component_id
      LEFT JOIN arb.health_observations ho ON ho.health_observation_id=hs.health_observation_id
      WHERE c.component_id=$1`,[componentId]);
    return r.rows[0] ?? null;
  }
  async listDependencies(componentId?: string) {
    const r=componentId
      ? await this.pool.query(`SELECT * FROM arb.v_enterprise_dependency_registry WHERE consumer_component_id=$1 ORDER BY dependency_id`,[componentId])
      : await this.pool.query(`SELECT * FROM arb.v_enterprise_dependency_registry ORDER BY consumer_domain_code,consumer_component_code,dependency_id`);
    return r.rows;
  }
}
