import { GeminiAuthConfig } from '../config/geminiAuthConfig';
import { GeminiAuthProvider, GeminiAccessToken, GeminiCredentialHealth } from './GeminiAuthTypes';

export class GeminiApiKeyAuthentication implements GeminiAuthProvider {
  readonly mode = 'API_KEY' as const;
  constructor(private readonly config: GeminiAuthConfig) {}
  canUse(): boolean { return Boolean(this.config.GEMINI_API_KEY); }
  async getToken(): Promise<GeminiAccessToken> { return { apiKey: this.config.GEMINI_API_KEY, authMode: this.mode }; }
  async healthCheck(): Promise<GeminiCredentialHealth> {
    return { healthy: this.canUse(), mode: this.mode, reason: this.canUse() ? undefined : 'GEMINI_API_KEY missing', checkedAt: new Date().toISOString() };
  }
}
