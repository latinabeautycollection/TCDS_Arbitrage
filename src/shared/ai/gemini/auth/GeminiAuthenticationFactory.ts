import { GeminiAuthConfig } from '../config/geminiAuthConfig';
import { AuthenticationDiscovery } from './AuthenticationDiscovery';
import { GeminiAuthProvider } from './GeminiAuthTypes';
import { FailoverAuthentication } from './FailoverAuthentication';
import { ServiceAccountAuthentication } from './ServiceAccountAuthentication';
import { GeminiApiKeyAuthentication } from './GeminiApiKeyAuthentication';
import { VertexAuthentication } from './VertexAuthentication';

export class GeminiAuthenticationFactory {
  constructor(private readonly config: GeminiAuthConfig) {}

  async discover(): Promise<GeminiAuthProvider> {
    return new AuthenticationDiscovery(this.config).discover();
  }

  failover(): FailoverAuthentication {
    return new FailoverAuthentication([
      new ServiceAccountAuthentication(this.config),
      new GeminiApiKeyAuthentication(this.config),
      new VertexAuthentication(this.config),
    ]);
  }
}
