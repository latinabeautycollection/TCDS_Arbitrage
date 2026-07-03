import { ListingSourceRepository } from '../repositories/listingSourceRepository';
import { ProductDigitalTwinBuilder } from '../digitalTwin/productDigitalTwinBuilder';
import { ProductDigitalTwinRepository } from '../repositories/productDigitalTwinRepository';
import { CategorySpecialistRouter } from '../categoryEngines/categorySpecialistRouter';
import { AiPerformanceRepository } from '../repositories/aiPerformanceRepository';
import { AiPerformanceRouter } from '../orchestration/aiPerformanceRouter';
import { MultiObjectiveOptimizationEngine } from '../optimization/multiObjectiveOptimizationEngine';
import { AdvancedPhotoIntelligenceEngine } from '../photo/advancedPhotoIntelligenceEngine';
import { ListingGenerationService } from './listingGenerationService';
import { ListingKnowledgeGraphService } from '../knowledgeGraph/listingKnowledgeGraphService';

export class EnterpriseListingPlatformService {
  private readonly sourceRepo = new ListingSourceRepository();
  private readonly twinBuilder = new ProductDigitalTwinBuilder();
  private readonly twinRepo = new ProductDigitalTwinRepository();
  private readonly categoryRouter = new CategorySpecialistRouter();
  private readonly aiPerformanceRepo = new AiPerformanceRepository();
  private readonly optimizer = new MultiObjectiveOptimizationEngine();
  private readonly photoEngine = new AdvancedPhotoIntelligenceEngine();
  private readonly generation = new ListingGenerationService();
  private readonly graph = new ListingKnowledgeGraphService();

  async generateEnterpriseDraft(sourceListingNormalizedId: number, processRunId?: string): Promise<{ draftId: number; totalScore: number; specialist: string; decision: string; }> {
    const sourceInput = await this.sourceRepo.getSourceInput(sourceListingNormalizedId);
    const source = { ...sourceInput, id: sourceInput.sourceListingNormalizedId, listing_title: sourceInput.title, title: sourceInput.title, photo_urls: sourceInput.imageUrls, category: sourceInput.category, expected_sale_price: sourceInput.recommendedSalePriceUsd, min_acceptable_price_usd: sourceInput.minAcceptablePriceUsd, expected_profit_usd: sourceInput.expectedProfitUsd, risk_flags_json: sourceInput.riskFlags };
    if (!source) throw new Error(`Source listing not found: ${sourceListingNormalizedId}`);
    const twin = this.twinBuilder.build(source);
    const specialist = this.categoryRouter.route(twin);
    const perf = await this.aiPerformanceRepo.listPerformance().catch(() => []);
    const router = new AiPerformanceRouter(perf);
    const titleProvider = router.chooseProvider('title_generation', specialist.specialist, ['openai','claude']);
    const reviewProvider = router.chooseProvider('compliance_review', specialist.specialist, ['claude','openai']);
    const visionProvider = router.chooseProvider('photo_validation', specialist.specialist, ['gemini']);
    const photo = this.photoEngine.analyze(twin);
    twin.photos = twin.photos.map((p, idx) => ({ ...p, complianceScore: idx === 0 ? photo.complianceScore : p.complianceScore }));
    twin.listing.seoKeywords = [...new Set([...(twin.listing.seoKeywords ?? []), ...(specialist.requiredSignals ?? [])])];
    const score = this.optimizer.score(twin);
    await this.twinRepo.upsert(twin, processRunId);
    await this.graph.addEdge({ fromType:'listing_normalized', fromPk:String(sourceListingNormalizedId), toType:'product_digital_twin', toPk:String(sourceListingNormalizedId), edgeType:'NORMALIZED_TO', evidence:{ specialist, titleProvider, reviewProvider, visionProvider, score }, processRunId }).catch(() => undefined);
    const generated = await this.generation.generateDraft(sourceListingNormalizedId, { processRunId, enterpriseContext: { specialist, score, titleProvider, reviewProvider, visionProvider, photo } } as any);
    return { draftId: Number((generated as any).draftId ?? (generated as any).id ?? 0), totalScore: score.totalScore, specialist: specialist.specialist, decision: score.totalScore >= 0.72 && photo.complianceScore >= 0.55 ? 'APPROVE_DRAFT' : 'HUMAN_REVIEW' };
  }
}
