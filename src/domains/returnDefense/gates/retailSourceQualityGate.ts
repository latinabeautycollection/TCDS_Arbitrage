import type { PoolClient } from "pg";
import type { GateEvaluation } from "./gateTypes";

export class RetailSourceQualityGate {
  public async evaluate(
    client: PoolClient,
    passportId: string,
    input: Record<string, unknown>,
  ): Promise<GateEvaluation> {
    const result = await client.query<{ evaluation: GateEvaluation }>(
      "select return_defense.evaluate_retail_source_quality($1::uuid,$2::jsonb) evaluation",
      [passportId, JSON.stringify(input)],
    );
    return result.rows[0]!.evaluation;
  }
}
