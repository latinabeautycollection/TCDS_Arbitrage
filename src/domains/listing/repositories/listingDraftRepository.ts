import { getPool } from './db';
import { GeneratedListingDraft, ListingQualityScores, ConsensusDecision } from '../models/listingTypes';

export class ListingDraftRepository {
  async createDraft(input: { sourceListingNormalizedId:number; arbitrageDecisionId?:number|null; generationRunId:number; draft:GeneratedListingDraft; quality:ListingQualityScores; consensus:ConsensusDecision; generationVersion:string; }): Promise<number> {
    const sql = `INSERT INTO arb.ebay_listing_draft (
      source_listing_normalized_id, arbitrage_decision_id, draft_status, category_id, category_suggestion_confidence,
      title, subtitle, description_html, bullet_points, item_specifics, condition_id, condition_text,
      listing_format, listing_duration, quantity, listing_price_usd, min_acceptable_price_usd,
      seo_keywords, generation_method, generation_version, validation_errors,
      ai_generation_run_id, ai_consensus_status, ai_consensus_score, photo_confidence_score, seo_score, compliance_score, disclosure_score, persuasive_copy_score, human_review_required, publish_blockers_json, image_assets_json, ai_trace_json
    ) VALUES ($1,$2,'GENERATED',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'HYBRID',$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
    RETURNING id`;
    const d=input.draft, q=input.quality, c=input.consensus;
    const vals=[input.sourceListingNormalizedId,input.arbitrageDecisionId||null,d.categoryId||null,null,d.title,d.subtitle||null,d.descriptionHtml,JSON.stringify(d.bulletPoints),JSON.stringify(d.itemSpecifics),d.conditionId||null,d.conditionText,d.listingFormat,d.listingDuration,d.quantity,d.listingPriceUsd,d.minAcceptablePriceUsd||null,JSON.stringify(d.seoKeywords),input.generationVersion,JSON.stringify(c.blockers),input.generationRunId,c.decision,c.score,q.imageQualityScore,q.keywordCoverageScore,q.complianceScore,q.flawDisclosureScore,q.persuasiveCopyScore,c.humanReviewRequired,JSON.stringify(c.blockers),JSON.stringify(d.photoUrls),JSON.stringify(c.trace)];
    const { rows } = await getPool().query(sql, vals);
    return Number(rows[0].id);
  }
  async markApproved(draftId:number, reviewedBy='system'): Promise<void> {
    await getPool().query(`UPDATE arb.ebay_listing_draft SET draft_status='APPROVED', updated_at=now() WHERE id=$1`, [draftId]);
    await getPool().query(`INSERT INTO arb.listing_human_review_decisions (ebay_listing_draft_id, source_listing_normalized_id, review_status, reviewed_by, reviewed_at)
      SELECT id, source_listing_normalized_id, 'APPROVED', $2, now() FROM arb.ebay_listing_draft WHERE id=$1`, [draftId, reviewedBy]);
  }
  async getDraft(draftId:number): Promise<any> { const { rows }=await getPool().query(`SELECT * FROM arb.ebay_listing_draft WHERE id=$1`,[draftId]); if(!rows[0]) throw new Error(`draft not found ${draftId}`); return rows[0]; }
}
