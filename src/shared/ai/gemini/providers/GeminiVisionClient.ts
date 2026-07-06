import { GeminiProvider } from './GeminiProvider';
import { GeminiAuthConfig, loadGeminiAuthConfig } from '../config/geminiAuthConfig';

export interface SharedGeminiVisionInput {
  imageBase64: string;
  mimeType?: string;
  prompt: string;
  model?: string;
}

export interface SharedGeminiVisionOutput {
  text: string;
  model: string;
  authMode: string;
  raw?: unknown;
}

export class GeminiVisionClient {
  private readonly provider: GeminiProvider;
  constructor(config: GeminiAuthConfig = loadGeminiAuthConfig()) {
    this.provider = new GeminiProvider(config);
  }

  analyze(input: SharedGeminiVisionInput): Promise<SharedGeminiVisionOutput> {
    return this.provider.generate({ prompt: input.prompt, imageBase64: input.imageBase64, mimeType: input.mimeType, model: input.model });
  }
}
