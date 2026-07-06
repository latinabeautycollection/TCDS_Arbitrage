import type { PhotoProcessingContext, VisionAnalysis } from '../models/photoTypes';
export interface VisionProvider {
  name: 'openai'|'claude'|'gemini'|'local';
  model: string;
  enabled(): boolean;
  analyze(buffer: Buffer, context: PhotoProcessingContext): Promise<VisionAnalysis>;
}
export function safeVisionJson(text: string): any {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end+1));
  return JSON.parse(text);
}
export function normalizeVision(provider: any, model: string, raw: any, latencyMs: number): VisionAnalysis {
  return {
    provider, model, success: true, confidence: Number(raw.confidence ?? 70),
    productVisible: raw.productVisible !== false,
    watermarkDetected: !!raw.watermarkDetected,
    textOverlayDetected: !!raw.textOverlayDetected,
    borderDetected: !!raw.borderDetected,
    aiAlterationRisk: Number(raw.aiAlterationRisk ?? 0),
    conditionDisclosureRisk: Number(raw.conditionDisclosureRisk ?? 0),
    detectedRole: raw.detectedRole ?? 'UNKNOWN',
    detectedDefects: Array.isArray(raw.detectedDefects) ? raw.detectedDefects : [],
    detectedIdentifiers: Array.isArray(raw.detectedIdentifiers) ? raw.detectedIdentifiers : [],
    suggestedReshootReasons: Array.isArray(raw.suggestedReshootReasons) ? raw.suggestedReshootReasons : [],
    raw, latencyMs, costEstimateUsd: Number(raw.costEstimateUsd ?? 0)
  };
}
export const VISION_PROMPT = `You are an enterprise eBay product photography reviewer. Return strict JSON only with keys: confidence number 0-100, productVisible boolean, watermarkDetected boolean, textOverlayDetected boolean, borderDetected boolean, aiAlterationRisk number 0-100, conditionDisclosureRisk number 0-100, detectedRole one of HERO FRONT BACK LEFT RIGHT TOP BOTTOM SERIAL DEFECT ACCESSORY PACKAGING LABEL UNKNOWN, detectedDefects string[], detectedIdentifiers string[], suggestedReshootReasons string[]. Evaluate marketplace compliance, buyer trust, product accuracy, and dispute defense.`;
