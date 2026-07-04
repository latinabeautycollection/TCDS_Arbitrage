import { GeminiAuthConfig } from '../config/geminiAuthConfig';
import { GeminiAuthProvider } from './GeminiAuthTypes';
import { ServiceAccountAuthentication } from './ServiceAccountAuthentication';
import { GeminiApiKeyAuthentication } from './GeminiApiKeyAuthentication';
import { VertexAuthentication } from './VertexAuthentication';
import { GeminiAuthError } from '../errors/GeminiAuthError';

export class AuthenticationDiscovery {
  constructor(private readonly config: GeminiAuthConfig) {}

  async discover(): Promise<GeminiAuthProvider> {
    const service = new ServiceAccountAuthentication(this.config);
    const apiKey = new GeminiApiKeyAuthentication(this.config);
    const vertex = new VertexAuthentication(this.config);

    if (this.config.GEMINI_AUTH_MODE === 'SERVICE_ACCOUNT') return this.mustUse(service);
    if (this.config.GEMINI_AUTH_MODE === 'API_KEY') return this.mustUse(apiKey);
    if (this.config.GEMINI_AUTH_MODE === 'VERTEX') return this.mustUse(vertex);

    if (await service.canUse()) return service;
    if (await apiKey.canUse()) return apiKey;

    throw new GeminiAuthError('No Gemini credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or GEMINI_API_KEY.', 'MISSING_CREDENTIALS', false);
  }

  private async mustUse(provider: GeminiAuthProvider): Promise<GeminiAuthProvider> {
    if (!(await provider.canUse())) throw new GeminiAuthError(`Configured Gemini auth mode ${provider.mode} is not usable`, 'MISSING_CREDENTIALS', false);
    return provider;
  }
}
