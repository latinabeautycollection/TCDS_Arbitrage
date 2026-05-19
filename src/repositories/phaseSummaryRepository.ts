import { PoolClient } from 'pg';

export interface AppendPhaseSummaryInput {
  entityType: string;
  entityPk: string;
  listingId?: string | null;
  candidateId?: number | null;
  watchlistId?: number | null;
  processName: string;
  processStage?: string | null;
  processRunId?: string | null;
  summaryLine: string;
  summaryOrder?: number;
}

export class PhaseSummaryRepository {
  constructor(private readonly client: PoolClient) {}

  async append(input: AppendPhaseSummaryInput) {
    await this.client.query(
      `
      insert into arb.phase_summary_events (
        entity_type,
        entity_pk,
        listing_id,
        candidate_id,
        watchlist_id,
        process_name,
        process_stage,
        process_run_id,
        summary_line,
        summary_order
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        input.entityType,
        input.entityPk,
        input.listingId ?? null,
        input.candidateId ?? null,
        input.watchlistId ?? null,
        input.processName,
        input.processStage ?? null,
        input.processRunId ?? null,
        input.summaryLine,
        input.summaryOrder ?? 0
      ]
    );
  }
}
