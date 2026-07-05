import type { PhotoProcessingContext } from '../models/photoTypes';
import { OpenAiVisionClient } from '../providers/openAiVisionClient';

export interface WatermarkResult {
  detected: boolean;
  severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: number;
  reasons: string[];
}

export class WatermarkDetectionEngine {
  constructor(private openai = new OpenAiVisionClient()) {}
  async detect(buffer: Buffer, context: PhotoProcessingContext, aiEnabled: boolean): Promise<WatermarkResult> {
    if (!aiEnabled || !this.openai.enabled()) {
      return { detected: false, severity: 'NONE', confidence: 0, reasons: ['AI watermark detection disabled; rule-based pass only.'] };
    }
    const v = await this.openai.analyze(buffer, context);
    const flagged = v.watermarkDetected || v.textOverlayDetected;
    return { detected: flagged, severity: flagged ? 'MEDIUM' : 'NONE', confidence: v.confidence, reasons: flagged ? ['Vision model flagged watermark/text overlay'] : [] };
  }
}
