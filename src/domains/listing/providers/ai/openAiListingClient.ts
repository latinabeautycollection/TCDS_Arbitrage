import { fetchJson } from '../../utils/fetchJson';
import { aiListingConfig } from '../../config/aiListingConfig';
import { AiProviderResult, OpenAiListingOutput } from '../../models/aiListingTypes';
import { ListingSourceInput } from '../../models/listingTypes';

export class OpenAiListingClient {
  constructor(private apiKey = process.env.OPENAI_API_KEY || '') {}

  async generateListing(input: ListingSourceInput): Promise<AiProviderResult<OpenAiListingOutput>> {
    if (!this.apiKey) return this.fallback(input);
    const started = Date.now();
    const schema = {
      name: 'listing_output', strict: true, schema: { type: 'object', additionalProperties: false, required: ['title','descriptionHtml','bulletPoints','seoKeywords','itemSpecifics','conditionText','defectDisclosures','listingFormat','listingDuration','quantity','listingPriceUsd','photoUrls','persuasiveAngles','searchIntentKeywords','buyerConfidencePhrases'], properties: {
        title:{type:'string'}, subtitle:{type:['string','null']}, descriptionHtml:{type:'string'}, bulletPoints:{type:'array',items:{type:'string'}}, seoKeywords:{type:'array',items:{type:'string'}}, itemSpecifics:{type:'object',additionalProperties:{type:['string','array'],items:{type:'string'}}}, conditionId:{type:['string','null']}, conditionText:{type:'string'}, defectDisclosures:{type:'array',items:{type:'string'}}, listingFormat:{type:'string',enum:['FIXED_PRICE','AUCTION']}, listingDuration:{type:'string',enum:['GTC','DAYS_7','DAYS_10']}, quantity:{type:'number'}, listingPriceUsd:{type:'number'}, minAcceptablePriceUsd:{type:['number','null']}, categoryId:{type:['string','null']}, photoUrls:{type:'array',items:{type:'string'}}, persuasiveAngles:{type:'array',items:{type:'string'}}, searchIntentKeywords:{type:'array',items:{type:'string'}}, buyerConfidencePhrases:{type:'array',items:{type:'string'}} }
      }};
    const res = await fetchJson<any>('https://api.openai.com/v1/responses', {
      method: 'POST', timeoutMs: 45000,
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: { model: aiListingConfig.openAiModel, input: [{ role: 'system', content: 'Generate accurate, defensible, SEO-rich eBay listing JSON. Do not invent facts.' }, { role: 'user', content: JSON.stringify(input) }], text: { format: { type: 'json_schema', ...schema } } }
    });
    const text = res.output_text || res.output?.[0]?.content?.[0]?.text || '{}';
    return { provider:'OPENAI', model:aiListingConfig.openAiModel, taskName:'GENERATE_LISTING', output: JSON.parse(text), confidenceScore: 0.86, riskFlags: [], latencyMs: Date.now()-started };
  }

  private fallback(input: ListingSourceInput): AiProviderResult<OpenAiListingOutput> {
    const title = [input.brand, input.model, input.mpn].filter(Boolean).join(' ') || input.title;
    return { provider:'OPENAI', model:'fallback-template', taskName:'GENERATE_LISTING', confidenceScore:0.55, riskFlags:['OPENAI_API_KEY_MISSING'], output: {
      title: title.slice(0,80), subtitle:null, descriptionHtml:`<p>${input.title}</p><p>${input.conditionText || 'See photos for condition.'}</p>`, bulletPoints:['Accurate item details','See photos','Ships with tracking'], seoKeywords:[input.brand||'',input.model||'',input.mpn||''].filter(Boolean), itemSpecifics:{Brand: input.brand || 'Unbranded', Model: input.model || 'Unknown'}, conditionId:null, conditionText: input.conditionText || 'Pre-owned', defectDisclosures: [], listingFormat:'FIXED_PRICE', listingDuration:'GTC', quantity:1, listingPriceUsd: input.recommendedSalePriceUsd, minAcceptablePriceUsd: input.minAcceptablePriceUsd ?? null, categoryId:null, photoUrls: input.imageUrls, persuasiveAngles:['Clear value','Buyer confidence'], searchIntentKeywords:[], buyerConfidencePhrases:['Ships with tracking'] }
    };
  }
}
