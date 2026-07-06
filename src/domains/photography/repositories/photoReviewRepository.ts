import type { Pool } from 'pg';
export class PhotoReviewRepository {
  constructor(private db: Pool) {}
  async enqueue(input: {candidateId?: number; listingId?: string; photoAssetId?: number; photoSetAssessmentId?: number; reviewType: string; priority?: number; reasonCodes: string[]; summary: string; details?: any; processRunId?: string;}) {
    const r = await this.db.query(`INSERT INTO arb.photo_review_queue(candidate_id,listing_id,photo_asset_id,photo_set_assessment_id,review_type,review_priority,reason_codes,review_summary,review_details_json,process_run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [input.candidateId ?? null,input.listingId ?? null,input.photoAssetId ?? null,input.photoSetAssessmentId ?? null,input.reviewType,input.priority ?? 100,input.reasonCodes,input.summary,input.details ?? {},input.processRunId ?? null]);
    return Number(r.rows[0].id);
  }
  async listQueued(limit=50) { const r=await this.db.query(`SELECT * FROM arb.photo_review_queue WHERE review_status='QUEUED' ORDER BY review_priority, created_at LIMIT $1`, [limit]); return r.rows; }
  async decide(id: number, decision: 'APPROVED_OVERRIDE'|'REJECTED_CONFIRMED'|'NEEDS_RESHOOT'|'DISMISSED', reviewerId: string, notes: string) { const r=await this.db.query(`UPDATE arb.photo_review_queue SET review_status=$2, reviewer_id=$3, reviewer_notes=$4, reviewed_at=now(), updated_at=now() WHERE id=$1 RETURNING *`, [id,decision,reviewerId,notes]); return r.rows[0]; }
}
