import type { PhotoInput, PhotoProcessingContext, PhotoProcessingResult } from '../models/photoTypes';
import { ExposureCorrectionEngine } from '../engines/exposureCorrectionEngine';
import { BackgroundRemovalEngine } from '../engines/backgroundRemovalEngine';
import { PhotoQualityScoringEngine } from '../engines/photoQualityScoringEngine';
import { PhotoSetIntelligenceEngine } from '../engines/photoSetIntelligenceEngine';
import { PhotoStorageService } from './photoStorageService';
import { PhotoRepository } from '../repositories/photoRepository';
import { PhotoReviewRepository } from '../repositories/photoReviewRepository';
import { EnterpriseLedgerRepository } from '../repositories/enterpriseLedgerRepository';
import { PhotographyError } from '../errors/PhotographyError';
import { request } from 'undici';

export class PhotoProcessingService {
  constructor(private photoRepo: PhotoRepository, private reviewRepo: PhotoReviewRepository, private ledger: EnterpriseLedgerRepository, private storage = new PhotoStorageService(), private exposure = new ExposureCorrectionEngine(), private background = new BackgroundRemovalEngine(), private scorer = new PhotoQualityScoringEngine(), private setEngine = new PhotoSetIntelligenceEngine()) {}
  async process(inputs: PhotoInput[], context: PhotoProcessingContext): Promise<PhotoProcessingResult> {
    const processRunId = context.processRunId ?? await this.ledger.startRun('domain5.photography.v2.process', context.actorType ?? 'worker', { candidateId: context.candidateId, listingId: context.listingId });
    const ctx = { ...context, processRunId };
    try {
      const assets = []; const perceptualHashes:string[]=[];
      for (const input of inputs) {
        const original = await this.loadInput(input); const originalStore = await this.storage.store(original, 'original');
        await this.ledger.addForensicEvent({ processRunId, entityType:'photo', entityPk: originalStore.sha256, eventType:'PHOTO_ORIGINAL_CAPTURED', actionType:'CAPTURE', evidence:{ originalUri: originalStore.uri, sourceUrl: input.sourceUrl, sha256: originalStore.sha256 }, sourceTable:'arb.product_photo_assets' });
        const corrected = await this.exposure.correct(original); const bg = await this.background.process(corrected.buffer, 'photoroom');
        const processedStore = await this.storage.store(bg.buffer, 'processed'); const thumb = await this.storage.thumbnail(bg.buffer); const thumbStore = await this.storage.store(thumb, 'thumbnail');
        const scored = await this.scorer.score(original, bg.buffer, ctx, perceptualHashes); perceptualHashes.push(scored.metadata.perceptualHash);
        scored.originalUri = originalStore.uri; scored.processedUri = processedStore.uri; scored.thumbnailUri = thumbStore.uri; scored.transformationChain = [{op:'original_preserved', sha256:originalStore.sha256}, ...(corrected.changed ? [{op: corrected.operation, scoreBefore: corrected.scoreBefore, scoreAfter: corrected.scoreAfter}] : []), ...bg.chain, {op:'thumbnail', provider:'local_sharp'}];
        if (input.role) scored.photoRole = input.role;
        const assetId = await this.photoRepo.saveAsset(ctx, scored);
        await this.ledger.addForensicEvent({ processRunId, entityType:'photo_asset', entityPk:String(assetId), eventType:'PHOTO_PROCESSED', actionType:'UPSERT', evidence:{ originalSha256: scored.metadata.sha256, processedSha256: scored.processedSha256, transformationChain: scored.transformationChain, approvalStatus: scored.approvalStatus }, metrics:{ qualityScore: scored.qualityScore, sharpnessScore: scored.sharpnessScore, exposureScore: scored.exposureScore, backgroundScore: scored.backgroundScore }, flags: scored.rejectionReasons });
        if (scored.reviewRequired) await this.reviewRepo.enqueue({ candidateId: ctx.candidateId, listingId: ctx.listingId, photoAssetId: assetId, reviewType:'PHOTO_ASSET', priority: 30, reasonCodes: scored.rejectionReasons, summary:'Photo requires human review before eBay listing publication.', details: scored, processRunId });
        assets.push(scored);
      }
      const set = this.setEngine.assess(assets, ctx); const assessmentId = await this.photoRepo.saveSetAssessment(ctx, set); await this.photoRepo.writeListingConversionEvidence(ctx, set);
      if (set.reviewRequired) await this.reviewRepo.enqueue({ candidateId: ctx.candidateId, listingId: ctx.listingId, photoSetAssessmentId: assessmentId, reviewType:'PHOTO_SET', priority: 20, reasonCodes: set.flags, summary:'Photo set is not fully eBay-ready.', details: set, processRunId });
      await this.ledger.addForensicEvent({ processRunId, entityType:'photo_set', entityPk:String(assessmentId), eventType:'PHOTO_SET_CERTIFIED', actionType:'CERTIFY', evidence:set, metrics:{ photo_quality_score:set.photoSetQualityScore, buyer_trust_score:set.buyerTrustScore, dispute_defense_score:set.disputeDefenseScore }, flags:set.flags });
      await this.ledger.finishRun(processRunId, 'SUCCEEDED', { photoQualityScore: set.photoSetQualityScore, approvedPhotoCount: set.approvedPhotoCount });
      return { context: ctx, listingPhotos: set.listingPhotos, photoQualityScore: set.photoSetQualityScore, photoSetAssessment: set, assets };
    } catch(e:any) { await this.ledger.finishRun(processRunId, 'FAILED', { error: e.message }); throw e; }
  }
  private async loadInput(input: PhotoInput): Promise<Buffer> {
    if (input.buffer) return input.buffer;
    if (input.uri && input.uri.startsWith('/')) return await import('fs/promises').then(fs=>fs.readFile(input.uri!));
    const url = input.uri ?? input.sourceUrl; if (!url) throw new PhotographyError('Photo input must include uri, sourceUrl, or buffer', 'PHOTO_INPUT_MISSING');
    const resp = await request(url); if (resp.statusCode >= 300) throw new PhotographyError(`Failed to fetch photo ${resp.statusCode}`, 'PHOTO_FETCH_FAILED', true);
    return Buffer.from(await resp.body.arrayBuffer());
  }
}
