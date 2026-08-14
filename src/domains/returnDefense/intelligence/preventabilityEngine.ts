
import type { PoolClient } from "pg";

export class PreventabilityEngine {
  public async assess(
    client: PoolClient,
    outcomeId: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `select jsonb_build_object(
        'outcome_id',$1::uuid,
        'decision_count',count(distinct d.prevention_decision_id),
        'mandatory_controls',count(distinct c.required_control_id),
        'completed_controls',count(distinct c.required_control_id)
          filter(where c.requirement_status in ('SATISFIED','WAIVED')),
        'assessment_status','HUMAN_REVIEW_REQUIRED'
       ) result
       from return_defense.outcome_observations o
       left join return_defense.prevention_decisions d
        on d.prevention_decision_id=o.prevention_decision_id
       left join return_defense.required_controls c
        on c.prevention_decision_id=d.prevention_decision_id
       where o.tenant_id=return_defense.current_tenant_id()
        and o.outcome_observation_id=$1::uuid`,
      [outcomeId],
    );
    return result.rows[0]!.result as Record<string, unknown>;
  }
}
