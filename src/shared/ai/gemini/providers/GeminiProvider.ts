import { GeminiClient, GeminiGenerateInput, GeminiGenerateOutput } from './GeminiClient';
import { GeminiAuthConfig, loadGeminiAuthConfig } from '../config/geminiAuthConfig';

export class GeminiProvider {
  private readonly client: GeminiClient;
  constructor(config: GeminiAuthConfig = loadGeminiAuthConfig()) {
    this.client = new GeminiClient(config);
  }

  generate(input: GeminiGenerateInput): Promise<GeminiGenerateOutput> {
    return this.client.generate(input);
  }
}
