import { Pool } from 'pg';
import { loadPhotographyEnv } from '../config/photographyEnv';
import { PhotoRetentionService } from '../services/photoRetentionService';

const env = loadPhotographyEnv();
const pool = new Pool({ connectionString: env.DATABASE_URL });
const workerName = process.env.WORKER_NAME ?? 'domain5-photo-retention-worker';
const workerInstanceId = `${workerName}-${process.pid}`;

async function heartbeat(status: string, details: Record<string, unknown> = {}) {
  await pool.query(`
    insert into arb.worker_heartbeats(worker_name, worker_instance_id, status, details_json, last_seen_at, updated_at)
    values ($1,$2,$3,$4,now(),now())
    on conflict(worker_name, worker_instance_id)
    do update set status=excluded.status, details_json=excluded.details_json, last_seen_at=now(), updated_at=now()
  `, [workerName, workerInstanceId, status, details]);
}

async function main() {
  await heartbeat('running');
  const service = new PhotoRetentionService(pool);
  const deleted = await service.deleteExpiredTempObjects();
  await heartbeat('idle', { deleted });
  await pool.end();
}

main().catch(async err => {
  await heartbeat('failed', { error: err.message }).catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
