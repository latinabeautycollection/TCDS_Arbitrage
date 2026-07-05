import type { Pool } from 'pg';
export async function collectPhotoMetrics(db: Pool) {
  const r = await db.query(`SELECT (SELECT count(*) FROM arb.product_photo_assets) total_assets, (SELECT count(*) FROM arb.product_photo_assets WHERE approval_status='APPROVED') approved_assets, (SELECT count(*) FROM arb.photo_review_queue WHERE review_status='QUEUED') review_queue_depth, (SELECT avg(cost_estimate_usd) FROM arb.photo_provider_call_ledger WHERE called_at > now()-interval '24 hours') avg_provider_cost_24h`);
  return r.rows[0];
}
