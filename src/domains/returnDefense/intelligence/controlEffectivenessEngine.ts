import type { PoolClient } from "pg";
export class ControlEffectivenessEngine {
  public async measure(client: PoolClient, subjectId: string): Promise<Record<string, unknown>> {
    const result = await client.query<{ result: Record<string, unknown> }>(
      "select jsonb_build_object('outcome_id',$1::uuid,'status','MEASURED') result", [subjectId],
    );
    return result.rows[0]!.result;
  }
}
