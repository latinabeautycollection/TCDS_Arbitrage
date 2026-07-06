import { GeminiProvider } from './GeminiProvider';
import { GeminiAuthConfig, loadGeminiAuthConfig } from '../config/geminiAuthConfig';

export class GeminiTextProvider {
  private readonly provider: GeminiProvider;
  constructor(config: GeminiAuthConfig = loadGeminiAuthConfig()) {
    this.provider = new GeminiProvider(config);
  }

  async generateText(prompt: string, model?: string): Promise<string> {
    const result = await this.provider.generate({ prompt, model });
    return result.text;
  }
}
