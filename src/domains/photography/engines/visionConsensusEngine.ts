import type { PhotoProcessingContext, VisionAnalysis, VisionConsensusResult, PhotoRole } from '../models/photoTypes';
import type { VisionProvider } from '../providers/visionProvider';
import { OpenAiVisionClient } from '../providers/openAiVisionClient';
import { ClaudeVisionClient } from '../providers/claudeVisionClient';
import { GeminiVisionClient } from '../providers/geminiVisionClient';

export class VisionConsensusEngine {
  constructor(private providers: VisionProvider[] = [new OpenAiVisionClient(), new ClaudeVisionClient(), new GeminiVisionClient()]) {}
  async analyze(buffer: Buffer, context: PhotoProcessingContext): Promise<VisionConsensusResult> {
    const enabled = this.providers.filter(p => p.enabled());
    const results: VisionAnalysis[] = [];
    for (const provider of enabled) {
      try { results.push(await provider.analyze(buffer, context)); }
      catch (e:any) { results.push({ provider: provider.name, model: provider.model, success:false, confidence:0, productVisible:false, watermarkDetected:false, textOverlayDetected:false, borderDetected:false, aiAlterationRisk:0, conditionDisclosureRisk:0, detectedRole:'UNKNOWN', detectedDefects:[], detectedIdentifiers:[], suggestedReshootReasons:[e.message], raw:{}, error:e.message }); }
    }
    if (!results.length) return { providerResults: [], consensusConfidence: 50, productVisible: true, watermarkRiskScore: 0, textOverlayRiskScore: 0, borderRiskScore: 0, aiAlterationRiskScore: 0, conditionDisclosureRisk: 0, detectedRole: 'UNKNOWN', detectedDefects: [], detectedIdentifiers: [], flags: ['VISION_PROVIDERS_DISABLED'], costEstimateUsd: 0 };
    const successful = results.filter(r=>r.success);
    const avg = (key: keyof VisionAnalysis) => successful.length ? successful.reduce((a,r)=>a+Number(r[key]||0),0)/successful.length : 0;
    const roleCounts = new Map<PhotoRole, number>(); successful.forEach(r=>roleCounts.set(r.detectedRole, (roleCounts.get(r.detectedRole)||0)+1));
    const detectedRole = [...roleCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? 'UNKNOWN';
    const flags = [...new Set(results.flatMap(r=>r.suggestedReshootReasons).concat(results.filter(r=>!r.success).map(r=>`PROVIDER_FAILED_${r.provider}`)) )];
    return {
      providerResults: results,
      consensusConfidence: avg('confidence'),
      productVisible: successful.some(r=>r.productVisible),
      watermarkRiskScore: successful.filter(r=>r.watermarkDetected).length / Math.max(1, successful.length) * 100,
      textOverlayRiskScore: successful.filter(r=>r.textOverlayDetected).length / Math.max(1, successful.length) * 100,
      borderRiskScore: successful.filter(r=>r.borderDetected).length / Math.max(1, successful.length) * 100,
      aiAlterationRiskScore: avg('aiAlterationRisk'),
      conditionDisclosureRisk: avg('conditionDisclosureRisk'),
      detectedRole,
      detectedDefects: [...new Set(successful.flatMap(r=>r.detectedDefects))],
      detectedIdentifiers: [...new Set(successful.flatMap(r=>r.detectedIdentifiers))],
      flags,
      costEstimateUsd: results.reduce((a,r)=>a+(r.costEstimateUsd ?? 0),0)
    };
  }
}
