import { PoolClient } from 'pg';

export class OpportunityQueueRepository {
  constructor(private readonly client: PoolClient) {}

  async findExisting(candidateId: number, watchlistId: number) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.opportunity_queue
      where candidate_id = $1
        and watchlist_id = $2
      order by id desc
      limit 1
      `,
      [candidateId, watchlistId]
    );
    return rows[0] ?? null;
  }

  async insertQueued(input: {
    candidateId: number;
    watchlistId: number;
    matchScore: number;
    priorityScore: number;
    reasonJson: Record<string, unknown>;
    processName: string;
    processRunId: string;
    actorType: string;
    actorId?: string | null;
    actorName?: string | null;
    phaseSummary: string;
  }) {
    const { rows } = await this.client.query(
  `
  insert into arb.opportunity_queue (
    candidate_id,
    watchlist_id,
    match_score,
    priority_score,
    status,
    reason_json,
    process_name,
    process_run_id,
    actor_type,
    actor_id,
    actor_name,
    queued_at,
    phase_summary_current
  )
  select $1,$2,$3,$4,'queued',$5::jsonb,$6,$7,$8,$9,$10,now(),$11
    from arb.candidates c
  join arb.listings l on l.id = c.listing_id
  where c.id = $1
    and (l.end_time is null or l.end_time > now())
    and coalesce(c.identity_confidence, 0) >= 0.5
  returning *
  `,
  [
    input.candidateId,
    input.watchlistId,
    input.matchScore,
    input.priorityScore,
    JSON.stringify(input.reasonJson),
    input.processName,
    input.processRunId,
    input.actorType,
    input.actorId ?? null,
    input.actorName ?? null,
    input.phaseSummary
  ]
);
return rows[0]; // undefined if the listing has already ended; callers should handle
  }

  async updateStatus(
    opportunityId: number,
    status: 'queued' | 'reviewed' | 'purchased' | 'passed' | 'expired',
    phaseSummary?: string | null
  ) {
    const { rows } = await this.client.query(
      `
      update arb.opportunity_queue
      set
        status = $2,
        phase_summary_current = coalesce($3, phase_summary_current),
        updated_at = now()
      where id = $1
      returning *
      `,
      [opportunityId, status, phaseSummary ?? null]
    );
    return rows[0];
  }

  async getByCandidateId(candidateId: number) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.opportunity_queue
      where candidate_id = $1
      order by id desc
      `,
      [candidateId]
    );
    return rows;
  }
}
