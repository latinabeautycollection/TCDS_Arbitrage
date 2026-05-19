import { withTx } from '../db/tx';
import { ForensicEventRepository } from '../repositories/forensicEventRepository';

export interface ReplayRequestInput {
  sourceProcessRunId?: string | null;
  sourceForensicEventId?: number | null;
  replayScope: 'RUN' | 'ENTITY' | 'STEP' | 'EVENT';
  requestedBy: string;
  reason: string;
  payloadJson?: Record<string, unknown>;
}

export class ReplayService {
  async createReplayRequest(input: ReplayRequestInput) {
    return withTx(async (client) => {
      const { rows } = await client.query(
        `
        insert into arb.replay_requests (
          source_process_run_id,
          source_forensic_event_id,
          replay_scope,
          replay_status,
          requested_by,
          reason,
          payload_json
        )
        values ($1,$2,$3,'QUEUED',$4,$5,$6::jsonb)
        returning *
        `,
        [
          input.sourceProcessRunId ?? null,
          input.sourceForensicEventId ?? null,
          input.replayScope,
          input.requestedBy,
          input.reason,
          JSON.stringify(input.payloadJson ?? {})
        ]
      );
      return rows[0];
    });
  }

  async markReplayRunning(replayId: number) {
    return withTx(async (client) => {
      const { rows } = await client.query(
        `
        update arb.replay_requests
        set
          replay_status = 'RUNNING',
          started_at = now()
        where id = $1
        returning *
        `,
        [replayId]
      );
      return rows[0] ?? null;
    });
  }

  async markReplaySucceeded(replayId: number, resultJson?: Record<string, unknown>) {
    return withTx(async (client) => {
      const { rows } = await client.query(
        `
        update arb.replay_requests
        set
          replay_status = 'SUCCEEDED',
          completed_at = now(),
          result_json = coalesce(result_json, '{}'::jsonb) || $2::jsonb
        where id = $1
        returning *
        `,
        [replayId, JSON.stringify(resultJson ?? {})]
      );
      return rows[0] ?? null;
    });
  }

  async markReplayFailed(replayId: number, resultJson?: Record<string, unknown>) {
    return withTx(async (client) => {
      const { rows } = await client.query(
        `
        update arb.replay_requests
        set
          replay_status = 'FAILED',
          completed_at = now(),
          result_json = coalesce(result_json, '{}'::jsonb) || $2::jsonb
        where id = $1
        returning *
        `,
        [replayId, JSON.stringify(resultJson ?? {})]
      );
      return rows[0] ?? null;
    });
  }

  async getReplayRequest(replayId: number) {
    return withTx(async (client) => {
      const { rows } = await client.query(
        `select * from arb.replay_requests where id = $1`,
        [replayId]
      );
      return rows[0] ?? null;
    });
  }

  async reconstructRun(processRunId: string) {
    return withTx(async (client) => {
      const forensicRepo = new ForensicEventRepository(client);
      const events = await forensicRepo.getByRunId(processRunId);

      return {
        processRunId,
        eventCount: events.length,
        events
      };
    });
  }
}
