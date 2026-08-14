
import type { Pool } from "pg";
export class RecoveryDeadlineWorker {
  public constructor(private readonly pool: Pool) {}
  public async escalate(limit = 500): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      "select return_defense.escalate_post_sale_deadlines($1) count",
      [limit],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
