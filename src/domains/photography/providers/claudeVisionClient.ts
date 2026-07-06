import Anthropic from '@anthropic-ai/sdk';
import type { PhotoProcessingContext, VisionAnalysis } from '../models/photoTypes';
import { loadPhotographyEnv } from '../config/photographyEnv';
import { normalizeVision, safeVisionJson, VISION_PROMPT, VisionProvider } from './visionProvider';
export class ClaudeVisionClient implements VisionProvider {
  name = 'claude' as const; model: string; private client?: Anthropic;
  constructor(private env = loadPhotographyEnv()) { this.model = env.CLAUDE_VISION_MODEL; if (env.ANTHROPIC_API_KEY) this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }); }
  enabled() { return !!this.client; }
  async analyze(buffer: Buffer, context: PhotoProcessingContext): Promise<VisionAnalysis> {
    const started = Date.now(); if (!this.client) throw new Error('Claude Vision disabled');
    const msg = await this.client.messages.create({ model: this.model, max_tokens: 800, messages: [{ role: 'user', content: [{ type: 'text', text: `${VISION_PROMPT}\nContext: ${JSON.stringify(context)}` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buffer.toString('base64') } }] }] });
    const text = msg.content.map((c:any)=>c.text ?? '').join('\n');
    return normalizeVision('claude', this.model, safeVisionJson(text), Date.now()-started);
  }
}
