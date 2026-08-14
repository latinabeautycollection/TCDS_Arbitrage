
import type { PoolClient } from "pg";

export class RootCauseEngine {
  public async analyze(
    client: PoolClient,
    outcomeId: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.query<{
      root_cause_review_id: string;
      candidate_count: number;
    }>(
      `with created as (
         insert into return_defense.root_cause_reviews(
           tenant_id,outcome_observation_id,reviewer_role,correlation_id
         )
         values(
           return_defense.current_tenant_id(),$1::uuid,
           'DOMAIN8_REVIEWER',return_defense.current_correlation_id()
         )
         returning root_cause_review_id
       )
       select created.root_cause_review_id,
              count(v.root_cause_version_id)::int candidate_count
       from created
       cross join return_defense.root_cause_current_versions cv
       join return_defense.root_cause_versions v
         on v.root_cause_version_id=cv.root_cause_version_id
       group by created.root_cause_review_id`,
      [outcomeId],
    );
    return result.rows[0]!;
  }
}
