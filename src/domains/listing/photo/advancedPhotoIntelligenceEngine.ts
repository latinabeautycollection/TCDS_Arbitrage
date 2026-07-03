import { ProductDigitalTwin } from '../models/enterpriseListingTypes';

export interface PhotoIntelligenceResult { imageCount: number; primaryImageUrl?: string; complianceScore: number; findings: string[]; recommendedRoles: Array<{ url: string; role: string }>; }

export class AdvancedPhotoIntelligenceEngine {
  analyze(twin: ProductDigitalTwin): PhotoIntelligenceResult {
    const findings: string[] = [];
    if (twin.photos.length === 0) findings.push('No product photos available; listing must be blocked or sent to human review.');
    if (twin.photos.length < 3) findings.push('Low image count; add detail/accessory/defect photos before scaling volume.');
    const primaryImageUrl = twin.photos[0]?.processedUrl ?? twin.photos[0]?.originalUrl;
    const recommendedRoles = twin.photos.map((p, i) => ({ url: p.processedUrl ?? p.originalUrl, role: i === 0 ? 'PRIMARY' : i === 1 ? 'DETAIL' : 'SUPPORTING' }));
    const complianceScore = Math.max(0, Math.min(1, 0.35 + Math.min(twin.photos.length / 6, 1) * 0.45 + (primaryImageUrl ? 0.2 : 0)));
    return { imageCount: twin.photos.length, primaryImageUrl, complianceScore, findings, recommendedRoles };
  }
}
