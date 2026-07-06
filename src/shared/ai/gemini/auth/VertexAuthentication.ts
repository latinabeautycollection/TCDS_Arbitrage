import { ServiceAccountAuthentication } from './ServiceAccountAuthentication';
import { GeminiAuthConfig } from '../config/geminiAuthConfig';
import { GeminiAccessToken, GeminiCredentialHealth } from './GeminiAuthTypes';

export class VertexAuthentication extends ServiceAccountAuthentication {
  readonly mode: GeminiAccessToken['authMode'] = 'VERTEX';
  constructor(config: GeminiAuthConfig) { super(config); }
  async getToken(): Promise<GeminiAccessToken> {
    const token = await super.getToken();
    return { ...token, authMode: this.mode };
  }
  async healthCheck(): Promise<GeminiCredentialHealth> {
    const h = await super.healthCheck();
    return { ...h, mode: this.mode };
  }
}
