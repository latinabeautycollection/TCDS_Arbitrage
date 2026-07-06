import type { Pool } from 'pg';
import type { PhotoAssetResult, PhotoProcessingContext, PhotoSetAssessment } from '../models/photoTypes';
const j = (v: any) => (v === undefined || v === null) ? null : JSON.stringify(v);
export class PhotoRepository {
  constructor(private db: Pool) {}
  async saveAsset(context: PhotoProcessingContext, asset: PhotoAssetResult) {
    const r = await this.db.query(`INSERT INTO arb.product_photo_assets(candidate_id,listing_id,source_listing_normalized_id,ebay_listing_draft_fk,photo_role,original_uri,processed_uri,thumbnail_uri,original_sha256,processed_sha256,perceptual_hash,width,height,mime_type,file_size_bytes,exif_json,metadata_json,transformation_chain_json,quality_score,sharpness_score,exposure_score,background_score,watermark_risk_score,text_overlay_risk_score,duplicate_risk_score,authenticity_risk_score,ai_alteration_risk_score,ebay_compliance_status,approval_status,rejection_reasons_json,provider_trace_json,process_run_id,process_step_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
      ON CONFLICT(original_sha256,candidate_id) DO UPDATE SET processed_uri=EXCLUDED.processed_uri, thumbnail_uri=EXCLUDED.thumbnail_uri, quality_score=EXCLUDED.quality_score, approval_status=EXCLUDED.approval_status, ebay_compliance_status=EXCLUDED.ebay_compliance_status, updated_at=now()
      RETURNING id`, [context.candidateId ?? null,context.listingId ?? null,context.sourceListingNormalizedId ?? null,context.ebayListingDraftFk ?? null,asset.photoRole,asset.originalUri,asset.processedUri ?? null,asset.thumbnailUri ?? null,asset.metadata.sha256,asset.processedSha256 ?? null,asset.metadata.perceptualHash,asset.metadata.width,asset.metadata.height,asset.metadata.mimeType,asset.metadata.fileSizeBytes,j(asset.metadata.exif),j(asset.metadata),j(asset.transformationChain),asset.qualityScore,asset.sharpnessScore,asset.exposureScore,asset.backgroundScore,asset.watermarkRiskScore,asset.textOverlayRiskScore,asset.duplicateRiskScore,asset.authenticityRiskScore,asset.aiAlterationRiskScore,asset.ebayComplianceStatus,asset.approvalStatus,j(asset.rejectionReasons),j(asset.providerTrace),context.processRunId ?? null,context.processStepId ?? null]);
    return Number(r.rows[0].id);
  }
  async saveSetAssessment(context: PhotoProcessingContext, a: PhotoSetAssessment) {
    const r = await this.db.query(`INSERT INTO arb.photo_set_assessments(candidate_id,listing_id,source_listing_normalized_id,ebay_listing_draft_fk,category_key,approved_photo_count,total_photo_count,photo_set_quality_score,primary_hero_score,angle_coverage_score,defect_disclosure_score,serial_evidence_score,accessory_coverage_score,packaging_evidence_score,buyer_trust_score,dispute_defense_score,ebay_compliance_status,review_required,required_missing_angles_json,flags_json,listing_photos,assessment_json,process_run_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`, [context.candidateId ?? null,context.listingId ?? null,context.sourceListingNormalizedId ?? null,context.ebayListingDraftFk ?? null,context.categoryKey ?? null,a.approvedPhotoCount,a.totalPhotoCount,a.photoSetQualityScore,a.primaryHeroScore,a.angleCoverageScore,a.defectDisclosureScore,a.serialEvidenceScore,a.accessoryCoverageScore,a.packagingEvidenceScore,a.buyerTrustScore,a.disputeDefenseScore,a.ebayComplianceStatus,a.reviewRequired,j(a.missingRequiredAngles),j(a.flags),j(a.listingPhotos),j(a),context.processRunId ?? null]);
    return Number(r.rows[0].id);
  }
  async listByCandidate(candidateId: number) { const r = await this.db.query(`SELECT * FROM arb.product_photo_assets WHERE candidate_id=$1 ORDER BY created_at`, [candidateId]); return r.rows; }
  async writeListingConversionEvidence(context: PhotoProcessingContext, a: PhotoSetAssessment) {
    if (!context.ebayListingDraftFk && !context.sourceListingNormalizedId) return;
    await this.db.query(`INSERT INTO arb.listing_conversion_evidence(ebay_listing_draft_fk,source_listing_normalized_id,category_key,image_count,image_quality_score,condition_clarity_score,flaw_disclosure_score,expected_conversion_probability,evidence_json,process_name,process_run_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'domain5.photography.v2.process',$10)`, [context.ebayListingDraftFk ?? null,context.sourceListingNormalizedId ?? null,context.categoryKey ?? null,a.approvedPhotoCount,a.photoSetQualityScore,a.defectDisclosureScore,a.defectDisclosureScore,Math.min(0.98, a.buyerTrustScore/100),j(a),context.processRunId ?? null]);
  }
}
