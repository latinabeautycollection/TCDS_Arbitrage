import OpenAI from 'openai';
import type { PhotoProcessingContext, VisionAnalysis } from '../models/photoTypes';
import { loadPhotographyEnv } from '../config/photographyEnv';
import { normalizeVision, safeVisionJson, VISION_PROMPT, VisionProvider } from './visionProvider';
export class OpenAiVisionClient implements VisionProvider {
  name = 'openai' as const; model: string; private client?: OpenAI;
  constructor(private env = loadPhotographyEnv()) { this.model = env.OPENAI_VISION_MODEL; if (env.OPENAI_API_KEY) this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY }); }
  enabled() { return !!this.client; }
  async analyze(buffer: Buffer, context: PhotoProcessingContext): Promise<VisionAnalysis> {
    const started = Date.now(); if (!this.client) throw new Error('OpenAI Vision disabled');
    const resp = await this.client.responses.create({ model: this.model, input: [{ role: 'user', content: [{ type: 'input_text', text: `${VISION_PROMPT}\nContext: ${JSON.stringify(context)}` }, { type: 'input_image', image_url: `data:image/jpeg;base64,${buffer.toString('base64')}`, detail: 'auto' }] }] });
    const text = (resp as any).output_text ?? JSON.stringify((resp as any).output ?? {});
    return normalizeVision('openai', this.model, safeVisionJson(text), Date.now()-started);
  }
}
