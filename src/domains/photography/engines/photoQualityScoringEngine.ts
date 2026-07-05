import type { PhotoAssetResult, PhotoProcessingContext } from '../models/photoTypes';
import { SharpnessScoringEngine } from './sharpnessScoringEngine';
import { ExposureCorrectionEngine } from './exposureCorrectionEngine';
import { BackgroundQualityEngine } from './backgroundQualityEngine';
import { DuplicateDetectionEngine } from './duplicateDetectionEngine';
import { VisionConsensusEngine } from './visionConsensusEngine';
import { EbayComplianceEngine } from './ebayComplianceEngine';
import { getImageMetadata } from '../utils/imageStats';
import { PHOTO_QUALITY_CONFIG } from '../config/photoQualityConfig';
import { sha256 } from '../utils/hash';

export class PhotoQualityScoringEngine {
  constructor(private sharpness = new SharpnessScoringEngine(), private exposure = new ExposureCorrectionEngine(), private background = new BackgroundQualityEngine(), private duplicate = new DuplicateDetectionEngine(), private vision = new VisionConsensusEngine(), private compliance = new EbayComplianceEngine()) {}
  async score(buffer: Buffer, processedBuffer: Buffer, context: PhotoProcessingContext, existingHashes: string[] = []): Promise<PhotoAssetResult> {
    const metadata = await getImageMetadata(buffer); const processedMeta = await getImageMetadata(processedBuffer);
    const sharpnessScore = await this.sharpness.score(processedBuffer);
    const exposureScore = await this.exposure.score(processedBuffer);
    const backgroundScore = await this.background.score(processedBuffer);
    const duplicateRiskScore = this.duplicate.score(metadata.perceptualHash, existingHashes);
    const consensus = await this.vision.analyze(processedBuffer, context);
    const qualityScore = Math.round(Math.max(0, Math.min(100, sharpnessScore*0.24 + exposureScore*0.18 + backgroundScore*0.16 + (100-consensus.watermarkRiskScore)*0.12 + (100-consensus.textOverlayRiskScore)*0.08 + (100-duplicateRiskScore)*0.08 + consensus.consensusConfidence*0.14)));
    const partial = { originalUri:'', processedUri:'', thumbnailUri:'', photoRole: context.categoryKey ? consensus.detectedRole : (consensus.detectedRole ?? 'UNKNOWN'), metadata, processedSha256: processedMeta.sha256, transformationChain: [], providerTrace: consensus.providerResults.map(r=>({provider:r.provider, model:r.model, success:r.success, confidence:r.confidence, latencyMs:r.latencyMs, costEstimateUsd:r.costEstimateUsd, error:r.error})), qualityScore, sharpnessScore, exposureScore, backgroundScore, watermarkRiskScore: consensus.watermarkRiskScore, textOverlayRiskScore: consensus.textOverlayRiskScore, duplicateRiskScore, authenticityRiskScore: metadata.sha256 === processedMeta.sha256 ? 0 : 8, aiAlterationRiskScore: consensus.aiAlterationRiskScore };
    const ev = this.compliance.evaluateAsset(partial);
    const approvalStatus = ev.status === 'PASS' && qualityScore >= PHOTO_QUALITY_CONFIG.approvalScore ? 'APPROVED' : ev.status === 'FAIL' ? 'REJECTED' : 'REVIEW';
    return { ...partial, originalUri:'', processedUri:'', thumbnailUri:'', ebayComplianceStatus: ev.status, approvalStatus, rejectionReasons: ev.reasons.concat(consensus.flags), reviewRequired: approvalStatus !== 'APPROVED' };
  }
}
