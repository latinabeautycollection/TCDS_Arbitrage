import { GeminiClient, loadGeminiAuthConfig } from '../../../../shared/ai/gemini/GeminiAuthenticationEngine';
import { aiListingConfig } from '../../config/aiListingConfig';
import { AiProviderResult, GeminiVisionOutput } from '../../models/aiListingTypes';

/**
 * Photo validation via the shared Gemini Authentication Engine.
 * AUTO auth discovery: service-account JSON -> API-key fallback (Domain 4+5 enterprise upgrade).
 * Degrades gracefully to a fallback result if credentials are absent/unhealthy.
 */
export class GeminiListingClient {
  private readonly client = new GeminiClient(loadGeminiAuthConfig());

  async validatePhotos(input: { imageUrls: string[]; listingClaims: unknown }): Promise<AiProviderResult<GeminiVisionOutput>> {
    if (!input.imageUrls.length) {
      return { provider: 'GEMINI', model: 'fallback-vision', taskName: 'PHOTO_VALIDATE', confidenceScore: 0.45, riskFlags: ['NO_IMAGES'], output: { photoConfidenceScore: 0, visibleDefects: [], missingAccessoryRisks: [], conditionMismatchFlags: [], imageQualityWarnings: ['NO_IMAGES'], primaryImageRecommendation: undefined } };
    }
    const started = Date.now();
    const prompt = `Analyze product photo URLs against listing claims. Return JSON only with photoConfidenceScore, visibleDefects, missingAccessoryRisks, conditionMismatchFlags, imageQualityWarnings, primaryImageRecommendation. ${JSON.stringify(input)}`;
    try {
      const result = await this.client.generate({ prompt, model: aiListingConfig.geminiModel });
      const text = (result.text || '{}').replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      return { provider: 'GEMINI', model: result.model, taskName: 'PHOTO_VALIDATE', output: JSON.parse(text), confidenceScore: 0.84, riskFlags: [], latencyMs: Date.now() - started };
    } catch (e: any) {
      return { provider: 'GEMINI', model: 'fallback-vision', taskName: 'PHOTO_VALIDATE', confidenceScore: 0.45, riskFlags: ['GEMINI_AUTH_OR_CALL_FAILED'], output: { photoConfidenceScore: 60, visibleDefects: [], missingAccessoryRisks: [], conditionMismatchFlags: [], imageQualityWarnings: [], primaryImageRecommendation: input.imageUrls[0] }, latencyMs: Date.now() - started };
    }
  }
}
