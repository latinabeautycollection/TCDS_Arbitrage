import { ListingSourceRepository } from '../repositories/listingSourceRepository';
import { ListingGenerationRepository } from '../repositories/listingGenerationRepository';
import { ListingDraftRepository } from '../repositories/listingDraftRepository';
import { ListingQualityRepository } from '../repositories/listingQualityRepository';
import { DisputeRiskRepository } from '../repositories/disputeRiskRepository';
import { ForensicRepository } from '../repositories/forensicRepository';
import { AiListingOrchestratorService } from './aiListingOrchestratorService';
import { aiListingConfig } from '../config/aiListingConfig';

export class ListingGenerationService {
  constructor(private sources=new ListingSourceRepository(), private runs=new ListingGenerationRepository(), private drafts=new ListingDraftRepository(), private qualityRepo=new ListingQualityRepository(), private disputeRepo=new DisputeRiskRepository(), private forensic=new ForensicRepository(), private orchestrator=new AiListingOrchestratorService()) {}
  async generateDraft(sourceListingNormalizedId:number, processRunId?:string|null): Promise<{draftId:number; decision:string; score:number; blockers:string[]}> {
    const source=await this.sources.getSourceInput(sourceListingNormalizedId);
    const runId=await this.runs.startRun({sourceListingNormalizedId, arbitrageDecisionId:source.arbitrageDecisionId, processRunId, snapshot:source});
    try {
      const result=await this.orchestrator.createConsensusDraft(source);
      for (const o of result.aiOutputs) await this.runs.recordModelOutput(runId,{provider:o.provider,model:o.model,taskName:o.taskName,output:o.output,confidenceScore:o.confidenceScore,riskFlags:o.riskFlags,tokensInput:o.tokensInput,tokensOutput:o.tokensOutput,costUsd:o.costUsd,latencyMs:o.latencyMs});
      const draftId=await this.drafts.createDraft({sourceListingNormalizedId, arbitrageDecisionId:source.arbitrageDecisionId, generationRunId:runId, draft:result.draft, quality:result.scores, consensus:result.decision, generationVersion:aiListingConfig.promptVersion});
      await this.qualityRepo.recordConversionEvidence({draftId, sourceListingNormalizedId, categoryKey:source.category, scores:result.scores, evidence:{decision:result.decision, imageAssets:result.imageAssets}, processName:'domain4_listing_generate_draft_v3', processRunId});
      await this.disputeRepo.record({draftId, disputeRiskScore:100-result.decision.score, requiredDisclosures:result.draft.defectDisclosures, requiredEvidence:['photos','source_listing_snapshot','tracking_after_sale'], processName:'domain4_listing_generate_draft_v3', processRunId});
      await this.runs.finishRun(runId, result.decision.decision==='BLOCK'?'BLOCKED':result.decision.humanReviewRequired?'HUMAN_REVIEW':'SUCCEEDED', draftId, result.decision, result.decision.blockers);
      await this.forensic.event({processRunId, entityType:'ebay_listing_draft', entityPk:String(draftId), eventType:'DOMAIN4_DRAFT_GENERATED', actionType:'INSERT', after:result.draft, evidence:result.decision, flags:result.decision.blockers});
      return {draftId, decision:result.decision.decision, score:result.decision.score, blockers:result.decision.blockers};
    } catch (e:any) { await this.runs.finishRun(runId,'FAILED',null,{error:e.message},[e.message]); throw e; }
  }
}
