import { fetchJson } from '../../utils/fetchJson';
import { aiListingConfig } from '../../config/aiListingConfig';
import { AiProviderResult, ClaudeReviewOutput } from '../../models/aiListingTypes';

export class ClaudeListingClient {
  constructor(private apiKey = process.env.ANTHROPIC_API_KEY || '') {}
  async reviewListing(input: unknown): Promise<AiProviderResult<ClaudeReviewOutput>> {
    if (!this.apiKey) return { provider:'CLAUDE', model:'fallback-review', taskName:'REVIEW_LISTING', confidenceScore:0.5, riskFlags:['ANTHROPIC_API_KEY_MISSING'], output:{ pass:true, revisionRequired:false, hallucinationFlags:[], unsupportedClaims:[], missingDisclosures:[], policyWarnings:[], improvedCopyNotes:['Fallback review only'], confidenceScore:0.5 } };
    const started=Date.now();
    const res = await fetchJson<any>('https://api.anthropic.com/v1/messages', { method:'POST', timeoutMs:45000, headers:{ 'x-api-key':this.apiKey, 'anthropic-version':'2023-06-01' }, body:{ model:aiListingConfig.claudeModel, max_tokens:2000, system:'Review eBay listing for truthfulness, defects, missing disclosures, policy issues. Return strict JSON.', messages:[{role:'user', content:`Return JSON: {"pass":boolean,"revisionRequired":boolean,"hallucinationFlags":string[],"unsupportedClaims":string[],"missingDisclosures":string[],"policyWarnings":string[],"improvedCopyNotes":string[],"confidenceScore":number}. Input: ${JSON.stringify(input)}`}] } });
    const text=res.content?.[0]?.text || '{}';
    return { provider:'CLAUDE', model:aiListingConfig.claudeModel, taskName:'REVIEW_LISTING', output: JSON.parse(text), confidenceScore:0.88, riskFlags:[], latencyMs:Date.now()-started };
  }
}
