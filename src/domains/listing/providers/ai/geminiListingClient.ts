import { fetchJson } from '../../utils/fetchJson';
import { aiListingConfig } from '../../config/aiListingConfig';
import { AiProviderResult, GeminiVisionOutput } from '../../models/aiListingTypes';

export class GeminiListingClient {
  constructor(private apiKey = process.env.GEMINI_API_KEY || '') {}
  async validatePhotos(input: { imageUrls: string[]; listingClaims: unknown }): Promise<AiProviderResult<GeminiVisionOutput>> {
    if (!this.apiKey || !input.imageUrls.length) return { provider:'GEMINI', model:'fallback-vision', taskName:'PHOTO_VALIDATE', confidenceScore:0.45, riskFlags:['GEMINI_API_KEY_OR_IMAGES_MISSING'], output:{ photoConfidenceScore: input.imageUrls.length?60:0, visibleDefects:[], missingAccessoryRisks:[], conditionMismatchFlags:[], imageQualityWarnings: input.imageUrls.length?[]:['NO_IMAGES'], primaryImageRecommendation: input.imageUrls[0] } };
    const started=Date.now();
    const prompt = `Analyze product photo URLs against listing claims. Return JSON with photoConfidenceScore, visibleDefects, missingAccessoryRisks, conditionMismatchFlags, imageQualityWarnings, primaryImageRecommendation. ${JSON.stringify(input)}`;
    const res=await fetchJson<any>(`https://generativelanguage.googleapis.com/v1beta/models/${aiListingConfig.geminiModel}:generateContent?key=${this.apiKey}`, {method:'POST', timeoutMs:45000, body:{contents:[{parts:[{text:prompt}]}], generationConfig:{responseMimeType:'application/json'}}});
    const text=res.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return { provider:'GEMINI', model:aiListingConfig.geminiModel, taskName:'PHOTO_VALIDATE', output:JSON.parse(text), confidenceScore:0.84, riskFlags:[], latencyMs:Date.now()-started };
  }
}
