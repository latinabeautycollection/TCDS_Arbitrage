import { GeminiClient, loadGeminiAuthConfig } from '../../../shared/ai/gemini/GeminiAuthenticationEngine';

export interface GeminiListingInput {
  title: string;
  brand?: string;
  model?: string;
  conditionText?: string;
  categoryKey?: string;
  compSummary?: unknown;
  photoQualitySummary?: unknown;
}

export interface GeminiListingOutput {
  titleSuggestions: string[];
  descriptionNotes: string[];
  itemSpecifics: Record<string, string>;
  seoKeywords: string[];
  riskFlags: string[];
  rawText: string;
}

export class GeminiListingClient {
  private readonly client = new GeminiClient(loadGeminiAuthConfig());

  async optimizeListing(input: GeminiListingInput): Promise<GeminiListingOutput> {
    const prompt = `You are optimizing an eBay arbitrage listing for conversion and buyer trust.\n` +
      `Return JSON only with titleSuggestions, descriptionNotes, itemSpecifics, seoKeywords, riskFlags.\n` +
      `Product: ${JSON.stringify(input)}`;
    const result = await this.client.generate({ prompt });
    try {
      const parsed = JSON.parse(result.text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
      return { titleSuggestions: parsed.titleSuggestions ?? [], descriptionNotes: parsed.descriptionNotes ?? [], itemSpecifics: parsed.itemSpecifics ?? {}, seoKeywords: parsed.seoKeywords ?? [], riskFlags: parsed.riskFlags ?? [], rawText: result.text };
    } catch {
      return { titleSuggestions: [], descriptionNotes: [result.text], itemSpecifics: {}, seoKeywords: [], riskFlags: ['GEMINI_NON_JSON_RESPONSE'], rawText: result.text };
    }
  }
}
