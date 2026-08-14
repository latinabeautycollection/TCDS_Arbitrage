
import type { Pool } from "pg";
export class DeliveryInterventionWorker {
  public constructor(private readonly pool: Pool) {}
  public async claim(workerId: string, limit = 25) {
    const result = await this.pool.query(
      "select * from return_defense.claim_interventions($1,$2,interval '5 minutes')",
      [workerId, limit],
    );
    return result.rows;
  }
}
