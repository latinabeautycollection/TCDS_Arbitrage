export const aiListingConfig = {
  openAiModel: process.env.DOMAIN4_OPENAI_MODEL || 'gpt-4.1-mini',
  claudeModel: process.env.DOMAIN4_CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
  geminiModel: process.env.DOMAIN4_GEMINI_MODEL || 'gemini-1.5-pro',
  maxTitleLength: 80,
  minQualityScoreToApprove: 82,
  minComplianceScoreToApprove: 92,
  minPhotoConfidenceToApprove: 70,
  promptVersion: 'domain4-listing-v3.0.0',
};
