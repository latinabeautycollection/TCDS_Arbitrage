import type { PoolClient } from "pg";

export class ListingDefenseAdapter {
  public async loadVerifiedSources(
    client: PoolClient,
    passportId: string,
    gateStage: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.query<{ facts: Record<string, unknown> }>(
      "select return_defense.load_passport_gate_sources($1::uuid,$2) facts",
      [passportId, gateStage],
    );
    return result.rows[0]!.facts;
  }
}
