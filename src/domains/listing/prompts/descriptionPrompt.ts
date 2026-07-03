export function buildDescriptionPrompt(input: unknown): string {
  return `Create a clean eBay HTML description with short paragraphs, bullet points, exact condition, included/missing items, and buyer-confidence wording. Do not overpromise. Input JSON: ${JSON.stringify(input)}`;
}
