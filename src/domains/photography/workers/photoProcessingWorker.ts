import { Pool } from 'pg';
import { loadPhotographyEnv } from '../config/photographyEnv';
import { PhotoJobRepository } from '../repositories/photoJobRepository';
import { PhotoRepository } from '../repositories/photoRepository';
import { PhotoReviewRepository } from '../repositories/photoReviewRepository';
import { EnterpriseLedgerRepository } from '../repositories/enterpriseLedgerRepository';
import { PhotoProcessingService } from '../services/photoProcessingService';
export async function runPhotoProcessingWorker() {
  const env = loadPhotographyEnv(); const db = new Pool({ connectionString: env.DATABASE_URL }); const worker = `domain5-photo-${process.pid}`;
  const jobs = new PhotoJobRepository(db); const ledger = new EnterpriseLedgerRepository(db); const service = new PhotoProcessingService(new PhotoRepository(db), new PhotoReviewRepository(db), ledger);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await db.query(`INSERT INTO arb.worker_heartbeats(worker_name,worker_instance_id,status,details_json,last_seen_at,updated_at) VALUES('domain5.photography.v2.worker',$1,'running',$2,now(),now()) ON CONFLICT(worker_name,worker_instance_id) DO UPDATE SET status='running', details_json=$2, last_seen_at=now(), updated_at=now()`, [worker, { pid: process.pid }]);
    const batch = await jobs.claimNext(worker, env.PHOTO_WORKER_BATCH_SIZE, env.PHOTO_WORKER_LOCK_SECONDS);
    for (const job of batch) {
      const runId = await ledger.startRun('domain5.photography.v2.worker', 'worker', { jobId: job.id });
      try { const result = await service.process(job.payload_json.photos, { ...job.payload_json.context, processRunId: runId, actorType:'worker' }); await jobs.complete(job.id, result, runId); }
      catch(e:any) { await jobs.fail(job.id, e); if (job.attempts + 1 >= job.max_attempts) await ledger.deadLetter({ processRunId: runId, queueName:'domain5.photo_processing_jobs', jobId:String(job.id), entityType:'photo_job', entityPk:String(job.id), errorCode:e.code, errorMessage:e.message, payload:job.payload_json, retryCount:job.attempts }); await ledger.finishRun(runId, 'FAILED', { error:e.message }); }
    }
    await new Promise(r=>setTimeout(r, batch.length ? 250 : 5000));
  }
}
if (require.main === module) runPhotoProcessingWorker().catch(e=>{ console.error(e); process.exit(1); });
