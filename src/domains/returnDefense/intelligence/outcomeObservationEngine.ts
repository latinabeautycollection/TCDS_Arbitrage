import type { PoolClient } from "pg";
export class OutcomeObservationEngine {
  public async recordOutcome(client: PoolClient, subjectId: string): Promise<Record<string, unknown>> {
    const result = await client.query<{ result: Record<string, unknown> }>(
      "select to_jsonb(o) result from return_defense.outcome_observations o where o.outcome_observation_id=$1::uuid", [subjectId],
    );
    return result.rows[0]!.result;
  }
}
