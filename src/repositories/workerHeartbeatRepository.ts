import { PoolClient } from 'pg';

export class WorkerHeartbeatRepository {
  constructor(private readonly client: PoolClient) {}

  async beat(workerName: string, pid: number, hostname: string, status: string, meta: unknown = {}) {
    await this.client.query(
      `
      insert into arb.worker_heartbeat (worker_name, pid, hostname, status, heartbeat_at, meta)
      values ($1,$2,$3,$4,now(),$5::jsonb)
      on conflict (worker_name)
      do update set
        pid = excluded.pid,
        hostname = excluded.hostname,
        status = excluded.status,
        heartbeat_at = excluded.heartbeat_at,
        meta = excluded.meta
      `,
      [workerName, pid, hostname, status, JSON.stringify(meta)]
    );
  }
}
