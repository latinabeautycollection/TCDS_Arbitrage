import type { Pool } from 'pg';
import { stableJsonHash } from '../utils/hash';
export class PhotoJobRepository {
  constructor(private db: Pool) {}
  async enqueue(payload: any) {
    const idempotency = payload.idempotencyKey ?? stableJsonHash(payload);
    const jobKey = payload.jobKey ?? `domain5-photo:${idempotency}`;
    const r = await this.db.query(`INSERT INTO arb.photo_processing_jobs(job_key,idempotency_key,candidate_id,listing_id,source_listing_normalized_id,ebay_listing_draft_fk,category_key,payload_json,priority,correlation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=now() RETURNING *`, [jobKey,idempotency,payload.context?.candidateId ?? null,payload.context?.listingId ?? null,payload.context?.sourceListingNormalizedId ?? null,payload.context?.ebayListingDraftFk ?? null,payload.context?.categoryKey ?? null,payload,payload.priority ?? 100,payload.context?.correlationId ?? null]);
    return r.rows[0];
  }
  async claimNext(worker: string, batchSize=5, lockSeconds=300) {
    const r = await this.db.query(`WITH picked AS (SELECT id FROM arb.photo_processing_jobs WHERE status IN ('QUEUED','RETRY') AND available_at <= now() AND (lock_expires_at IS NULL OR lock_expires_at < now()) ORDER BY priority ASC, created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED)
      UPDATE arb.photo_processing_jobs j SET status='RUNNING', locked_by=$2, locked_at=now(), lock_expires_at=now()+($3||' seconds')::interval, attempts=attempts+1, updated_at=now() FROM picked WHERE j.id=picked.id RETURNING j.*`, [batchSize, worker, lockSeconds]);
    return r.rows;
  }
  async complete(id: number, result: any, processRunId?: string) { await this.db.query(`UPDATE arb.photo_processing_jobs SET status='SUCCEEDED', result_json=$2, process_run_id=COALESCE($3,process_run_id), updated_at=now() WHERE id=$1`, [id,result,processRunId ?? null]); }
  async fail(id: number, err: any) { const retry = (err.retryable ?? true); await this.db.query(`UPDATE arb.photo_processing_jobs SET status=CASE WHEN attempts >= max_attempts OR $3=false THEN 'DEAD_LETTER' ELSE 'RETRY' END, available_at=now() + (power(2, LEAST(attempts, 8)) || ' minutes')::interval, last_error_code=$2, last_error_message=$4, last_error_class=$5, poison_detected=(attempts >= max_attempts), updated_at=now() WHERE id=$1`, [id,err.code ?? 'PHOTO_JOB_FAILED',retry,err.message ?? String(err),err.name ?? 'Error']); }
  async get(id: number) { const r = await this.db.query(`SELECT * FROM arb.photo_processing_jobs WHERE id=$1`, [id]); return r.rows[0]; }
}
