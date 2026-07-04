import { AuthenticationDiscovery } from './AuthenticationDiscovery';
import { GeminiAuthConfig } from '../config/geminiAuthConfig';

export class CredentialHealthCheck {
  constructor(private readonly config: GeminiAuthConfig) {}
  async run() {
    const provider = await new AuthenticationDiscovery(this.config).discover();
    return provider.healthCheck();
  }
}
