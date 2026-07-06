import { OpenAiListingClient } from '../providers/ai/openAiListingClient';
import { ClaudeListingClient } from '../providers/ai/claudeListingClient';
import { GeminiListingClient } from '../providers/ai/geminiListingClient';
import { PhotoIntelligenceEngine } from '../engines/photoIntelligenceEngine';
import { EbayFormattingEngine } from '../engines/ebayFormattingEngine';
import { ListingQualityEngine } from '../engines/listingQualityEngine';
import { AiConsensusEngine } from '../engines/aiConsensusEngine';
import { ListingSourceInput } from '../models/listingTypes';

export class AiListingOrchestratorService {
  constructor(private openai=new OpenAiListingClient(), private claude=new ClaudeListingClient(), private gemini=new GeminiListingClient(), private photos=new PhotoIntelligenceEngine(), private formatter=new EbayFormattingEngine(), private quality=new ListingQualityEngine(), private consensus=new AiConsensusEngine()){}
  async createConsensusDraft(input:ListingSourceInput) {
    const imageAssets=await this.photos.process(input.imageUrls);
    const generated=await this.openai.generateListing({...input, imageUrls: imageAssets.map(x=>x.cleanedUrl||x.sourceUrl)});
    const draft=this.formatter.format(generated.output);
    const claude=await this.claude.reviewListing({input,draft});
    const gemini=await this.gemini.validatePhotos({imageUrls: input.imageUrls, listingClaims:draft});
    const scores=this.quality.score(draft, gemini.output.photoConfidenceScore, [...claude.output.policyWarnings, ...claude.output.unsupportedClaims]);
    const decision=this.consensus.decide({draft, claude:claude.output, gemini:gemini.output, quality:scores});
    return { draft, imageAssets, aiOutputs:[generated,claude,gemini], scores, decision };
  }
}
