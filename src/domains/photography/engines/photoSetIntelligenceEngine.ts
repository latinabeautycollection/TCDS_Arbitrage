import type { PhotoAssetResult, PhotoProcessingContext, PhotoSetAssessment, PhotoRole } from '../models/photoTypes';
import { getCategoryPhotoPlaybook } from '../config/categoryPhotoPlaybooks';
export class PhotoSetIntelligenceEngine {
  assess(assets: PhotoAssetResult[], context: PhotoProcessingContext): PhotoSetAssessment {
    const playbook = getCategoryPhotoPlaybook(context.categoryKey); const approved = assets.filter(a=>a.approvalStatus==='APPROVED' && a.ebayComplianceStatus==='PASS');
    const roles = new Set(approved.map(a=>a.photoRole)); const missing = playbook.requiredRoles.filter(r=>!roles.has(r));
    const hero = approved.find(a=>a.photoRole==='HERO') ?? approved[0]; const primaryHeroScore = hero?.qualityScore ?? 0;
    const angleCoverageScore = Math.round((playbook.requiredRoles.length - missing.length) / Math.max(1, playbook.requiredRoles.length) * 100);
    const defectDisclosureScore = playbook.defectDisclosureRequired ? (roles.has('DEFECT') ? 100 : Math.max(40, 100 - Math.max(...assets.map(a=>a.aiAlterationRiskScore),0))) : 100;
    const serialEvidenceScore = playbook.serialEvidenceRequired ? (roles.has('SERIAL') ? 100 : 25) : 100;
    const accessoryCoverageScore = roles.has('ACCESSORY') ? 100 : 70;
    const packagingEvidenceScore = roles.has('PACKAGING') ? 100 : 65;
    const buyerTrustScore = Math.round(primaryHeroScore*0.25 + angleCoverageScore*0.25 + defectDisclosureScore*0.2 + serialEvidenceScore*0.2 + accessoryCoverageScore*0.1);
    const disputeDefenseScore = Math.round(serialEvidenceScore*0.35 + defectDisclosureScore*0.35 + angleCoverageScore*0.2 + packagingEvidenceScore*0.1);
    const photoSetQualityScore = Math.round(primaryHeroScore*0.30 + angleCoverageScore*0.25 + buyerTrustScore*0.25 + disputeDefenseScore*0.20);
    const flags:string[]=[]; if (approved.length < playbook.minApprovedPhotos) flags.push('INSUFFICIENT_APPROVED_PHOTOS'); if (missing.length) flags.push('MISSING_REQUIRED_ANGLES'); if (primaryHeroScore < playbook.minHeroScore) flags.push('HERO_BELOW_CATEGORY_STANDARD');
    const status = flags.some(f=>['INSUFFICIENT_APPROVED_PHOTOS','MISSING_REQUIRED_ANGLES'].includes(f)) ? 'REVIEW' : photoSetQualityScore >= playbook.minSetScore ? 'PASS' : 'REVIEW';
    const listingPhotos = approved.slice(0, playbook.maxPhotos).map(a=>({ role:a.photoRole, uri:a.processedUri ?? a.originalUri, thumbnail_uri:a.thumbnailUri, quality_score:a.qualityScore, sha256:a.processedSha256 ?? a.metadata.sha256 }));
    return { listingPhotos, approvedPhotoCount: approved.length, totalPhotoCount: assets.length, photoSetQualityScore, primaryHeroScore, angleCoverageScore, defectDisclosureScore, serialEvidenceScore, accessoryCoverageScore, packagingEvidenceScore, buyerTrustScore, disputeDefenseScore, ebayComplianceStatus: status as any, reviewRequired: status !== 'PASS' || flags.length > 0, missingRequiredAngles: missing as PhotoRole[], flags };
  }
}
