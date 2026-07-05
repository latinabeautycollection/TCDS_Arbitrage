import { GeminiClient, loadGeminiAuthConfig } from '../../../shared/ai/gemini/GeminiAuthenticationEngine';
import type { PhotoProcessingContext, VisionAnalysis } from '../models/photoTypes';
import { loadPhotographyEnv } from '../config/photographyEnv';
import { normalizeVision, safeVisionJson, VISION_PROMPT, VisionProvider } from './visionProvider';

export class GeminiVisionClient implements VisionProvider {
  name = 'gemini' as const;
  model: string;
  private client = new GeminiClient(loadGeminiAuthConfig());
  private hasCreds: boolean;
  constructor(private env = loadPhotographyEnv()) {
    this.model = env.GEMINI_VISION_MODEL;
    this.hasCreds = !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || env.GEMINI_API_KEY);
  }
  enabled() { return this.hasCreds; }
  async analyze(buffer: Buffer, context: PhotoProcessingContext): Promise<VisionAnalysis> {
    const started = Date.now();
    if (!this.hasCreds) throw new Error('Gemini Vision disabled');
    const result = await this.client.generate({
      prompt: `${VISION_PROMPT}\nContext: ${JSON.stringify(context)}`,
      imageBase64: buffer.toString('base64'),
      mimeType: 'image/jpeg',
    });
    return normalizeVision('gemini', result.model || this.model, safeVisionJson(result.text || '{}'), Date.now() - started);
  }
}
