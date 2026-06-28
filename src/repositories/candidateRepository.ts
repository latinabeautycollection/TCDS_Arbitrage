import { PoolClient } from 'pg';

export class CandidateRepository {
  constructor(private readonly client: PoolClient) {}

  async getById(candidateId: number) {
    const { rows } = await this.client.query(
      `select * from arb.candidates where id = $1`,
      [candidateId]
    );
    return rows[0] ?? null;
  }

  async getByListingId(listingId: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.candidates
      where listing_id = $1
      order by id desc
      `,
      [listingId]
    );
    return rows;
  }

  async claimForProcess(
    candidateId: number,
    processName: string,
    processRunId: string,
    claimedBy: string,
    claimTtlSeconds = 300
  ) {
    const { rows } = await this.client.query(
      `select * from arb.claim_candidate_for_process($1,$2,$3,$4,$5)`,
      [candidateId, processName, processRunId, claimedBy, claimTtlSeconds]
    );
    return rows[0] ?? null;
  }

  async markMatched(input: {
    candidateId: number;
     watchlistId: number | null;
    matchScore: number;
    processName: string;
    processRunId: string;
    actorType: string;
    actorId?: string | null;
    actorName?: string | null;
    phaseSummary: string;
  }) {
    const { rows } = await this.client.query(
      `
      update arb.candidates
      set
        status = 'matched',
        matched_watchlist_id = $2,
        matched_at = now(),
        best_watchlist_id = $2,
        best_match_score = $3,
        last_process_name = $4,
        last_process_stage = 'MATCHED',
        last_process_run_id = $5,
        last_actor_type = $6,
        last_actor_id = $7,
        last_actor_name = $8,
        phase_summary_current = $9,
        updated_at = now()
      where id = $1
      returning *
      `,
      [
        input.candidateId,
        input.watchlistId,
        input.matchScore,
        input.processName,
        input.processRunId,
        input.actorType,
        input.actorId ?? null,
        input.actorName ?? null,
        input.phaseSummary
      ]
    );
    return rows[0];
  }

  async markQueued(
    candidateId: number,
    processName: string,
    processRunId: string,
    phaseSummary: string
  ) {
    const { rows } = await this.client.query(
      `
      update arb.candidates
      set
        queued_at = now(),
        last_process_name = $2,
        last_process_stage = 'QUEUED',
        last_process_run_id = $3,
        phase_summary_current = $4,
        updated_at = now()
      where id = $1
      returning *
      `,
      [candidateId, processName, processRunId, phaseSummary]
    );
    return rows[0];
  }

  async markRejected(input: {
    candidateId: number;
    rejectionReasonCode: string;
    rejectionReasonDetail?: string | null;
    processName: string;
    processRunId: string;
    actorType: string;
    actorId?: string | null;
    actorName?: string | null;
    phaseSummary: string;
  }) {
    const { rows } = await this.client.query(
      `
      update arb.candidates
      set
        status = 'rejected',
        rejection_reason_code = $2,
        rejection_reason_detail = $3,
        last_process_name = $4,
        last_process_stage = 'REJECTED',
        last_process_run_id = $5,
        last_actor_type = $6,
        last_actor_id = $7,
        last_actor_name = $8,
        phase_summary_current = $9,
        updated_at = now()
      where id = $1
      returning *
      `,
      [
        input.candidateId,
        input.rejectionReasonCode,
        input.rejectionReasonDetail ?? null,
        input.processName,
        input.processRunId,
        input.actorType,
        input.actorId ?? null,
        input.actorName ?? null,
        input.phaseSummary
      ]
    );
    return rows[0];
  }

  async markProcessError(candidateId: number, errorMessage: string) {
    const { rows } = await this.client.query(
      `
      update arb.candidates
      set
        process_last_error = $2,
        process_last_error_at = now(),
        updated_at = now()
      where id = $1
      returning *
      `,
      [candidateId, errorMessage]
    );
    return rows[0];
  }
}
