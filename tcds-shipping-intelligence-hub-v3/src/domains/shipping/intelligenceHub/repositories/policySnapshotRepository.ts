import type { Pool, QueryResultRow } from "pg";

export class PolicySnapshotRepository {
  constructor(protected readonly pool: Pool) {}

  protected async query<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, values as unknown[]);
    return result.rows;
  }
}
