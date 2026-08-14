import type { PoolClient } from "pg";
export class LossAttributionEngine {
  public async attribute(client: PoolClient, subjectId: string): Promise<Record<string, unknown>> {
    const result = await client.query<{ result: Record<string, unknown> }>(
      "select return_defense.reconcile_loss_event($1::uuid) result", [subjectId],
    );
    return result.rows[0]!.result;
  }
}
