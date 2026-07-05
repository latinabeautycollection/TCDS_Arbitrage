import type { ComplianceStatus, PhotoAssetResult } from '../models/photoTypes';
import { PHOTO_QUALITY_CONFIG } from '../config/photoQualityConfig';
export class EbayComplianceEngine {
  evaluateAsset(asset: Omit<PhotoAssetResult,'ebayComplianceStatus'|'approvalStatus'|'rejectionReasons'|'reviewRequired'>): {status: ComplianceStatus; reasons: string[]} {
    const reasons:string[]=[]; const m=asset.metadata;
    if (m.width < PHOTO_QUALITY_CONFIG.minWidth || m.height < PHOTO_QUALITY_CONFIG.minHeight) reasons.push('IMAGE_BELOW_RECOMMENDED_RESOLUTION');
    if (asset.watermarkRiskScore > PHOTO_QUALITY_CONFIG.maxWatermarkRisk) reasons.push('WATERMARK_RISK');
    if (asset.textOverlayRiskScore > PHOTO_QUALITY_CONFIG.maxTextOverlayRisk) reasons.push('TEXT_OVERLAY_RISK');
    if (asset.aiAlterationRiskScore > PHOTO_QUALITY_CONFIG.maxAiAlterationRiskAutoApprove) reasons.push('AI_ALTERATION_REVIEW_REQUIRED');
    if (asset.duplicateRiskScore > 75) reasons.push('DUPLICATE_PHOTO');
    if (asset.qualityScore < PHOTO_QUALITY_CONFIG.reviewScore) reasons.push('LOW_IMAGE_QUALITY');
    const fail = reasons.some(r => ['WATERMARK_RISK','TEXT_OVERLAY_RISK','DUPLICATE_PHOTO'].includes(r)) || asset.qualityScore < 55;
    return { status: fail ? 'FAIL' : reasons.length ? 'REVIEW' : 'PASS', reasons };
  }
}
