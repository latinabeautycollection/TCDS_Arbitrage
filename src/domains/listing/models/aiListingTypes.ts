import { GeneratedListingDraft } from './listingTypes';

export interface AiProviderResult<T = unknown> {
  provider: 'OPENAI' | 'CLAUDE' | 'GEMINI' | 'SYSTEM';
  model: string;
  taskName: string;
  output: T;
  confidenceScore: number;
  riskFlags: string[];
  tokensInput?: number;
  tokensOutput?: number;
  costUsd?: number;
  latencyMs?: number;
}

export interface OpenAiListingOutput extends GeneratedListingDraft {
  persuasiveAngles: string[];
  searchIntentKeywords: string[];
  buyerConfidencePhrases: string[];
}

export interface ClaudeReviewOutput {
  pass: boolean;
  revisionRequired: boolean;
  hallucinationFlags: string[];
  unsupportedClaims: string[];
  missingDisclosures: string[];
  policyWarnings: string[];
  improvedCopyNotes: string[];
  confidenceScore: number;
}

export interface GeminiVisionOutput {
  photoConfidenceScore: number;
  visibleDefects: string[];
  missingAccessoryRisks: string[];
  conditionMismatchFlags: string[];
  imageQualityWarnings: string[];
  primaryImageRecommendation?: string;
}
