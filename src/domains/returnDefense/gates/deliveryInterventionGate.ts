import type { PoolClient } from "pg";
import type { PostSaleGateEvaluation } from "./postSaleGateTypes";

export class DeliveryInterventionGate {
  public async evaluate(
    client: PoolClient,
    passportId: string,
    facts: Record<string, unknown>,
  ): Promise<PostSaleGateEvaluation> {
    const result = await client.query<{ evaluation: PostSaleGateEvaluation }>(
      "select return_defense.evaluate_delivery_intervention($1::uuid,$2::jsonb) evaluation",
      [passportId, JSON.stringify(facts)],
    );
    return result.rows[0]!.evaluation;
  }
}
