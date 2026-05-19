import { withTx } from '../db/tx';

export class WorkerLifecycleService {
  async heartbeat(input: {
    workerName: string;
    workerInstanceId: string;
    status: string;
    detailsJson?: Record<string, unknown>;
  }) {
    return withTx(async (client) => {
      const { rows } = await client.query(
        `
        insert into arb.worker_heartbeats (
          worker_name,
          worker_instance_id,
          status,
          details_json,
          last_seen_at,
          updated_at
        )
        values ($1,$2,$3,$4::jsonb,now(),now())
        on conflict (worker_name, worker_instance_id)
        do update set
          status = excluded.status,
          details_json = excluded.details_json,
          last_seen_at = now(),
          updated_at = now()
        returning *
        `,
        [
          input.workerName,
          input.workerInstanceId,
          input.status,
          JSON.stringify(input.detailsJson ?? {})
        ]
      );

      return rows[0];
    });
  }

  async markStarting(workerName: string, workerInstanceId: string, detailsJson?: Record<string, unknown>) {
    return this.heartbeat({
      workerName,
      workerInstanceId,
      status: 'starting',
      detailsJson
    });
  }

  async markHealthy(workerName: string, workerInstanceId: string, detailsJson?: Record<string, unknown>) {
    return this.heartbeat({
      workerName,
      workerInstanceId,
      status: 'healthy',
      detailsJson
    });
  }

  async markDegraded(workerName: string, workerInstanceId: string, detailsJson?: Record<string, unknown>) {
    return this.heartbeat({
      workerName,
      workerInstanceId,
      status: 'degraded',
      detailsJson
    });
  }

  async markStopping(workerName: string, workerInstanceId: string, detailsJson?: Record<string, unknown>) {
    return this.heartbeat({
      workerName,
      workerInstanceId,
      status: 'stopping',
      detailsJson
    });
  }
}
