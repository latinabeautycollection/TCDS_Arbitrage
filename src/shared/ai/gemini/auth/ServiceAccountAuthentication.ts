import fs from 'node:fs';
import { GeminiAuthConfig } from '../config/geminiAuthConfig';
import { GeminiAuthProvider, GeminiAccessToken, GeminiCredentialHealth } from './GeminiAuthTypes';
import { OAuthTokenProvider } from './OAuthTokenProvider';
import { CredentialRotation } from './CredentialRotation';

export class ServiceAccountAuthentication implements GeminiAuthProvider {
  readonly mode: GeminiAccessToken['authMode'] = 'SERVICE_ACCOUNT';
  private readonly tokenProvider: OAuthTokenProvider;

  constructor(private readonly config: GeminiAuthConfig) {
    this.tokenProvider = new OAuthTokenProvider(config);
  }

  canUse(): boolean {
    return Boolean(this.config.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(this.config.GOOGLE_APPLICATION_CREDENTIALS));
  }

  async getToken(): Promise<GeminiAccessToken> {
    const token = await this.tokenProvider.getToken();
    return {
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      authMode: this.mode,
      projectId: token.projectId,
      location: this.config.GOOGLE_CLOUD_LOCATION,
      principal: token.principal,
    };
  }

  async healthCheck(): Promise<GeminiCredentialHealth> {
    try {
      if (!this.canUse()) {
        return { healthy: false, mode: this.mode, reason: 'GOOGLE_APPLICATION_CREDENTIALS missing or file does not exist', checkedAt: new Date().toISOString() };
      }
      const secure = CredentialRotation.assertSecureFile(this.config.GOOGLE_APPLICATION_CREDENTIALS!);
      const token = await this.getToken();
      return {
        healthy: Boolean(token.accessToken),
        mode: this.mode,
        principal: token.principal,
        projectId: token.projectId,
        reason: secure.ok ? undefined : secure.reason,
        checkedAt: new Date().toISOString(),
        expiresAt: token.expiresAt?.toISOString(),
      };
    } catch (e: any) {
      return { healthy: false, mode: this.mode, reason: e?.message ?? String(e), checkedAt: new Date().toISOString() };
    }
  }
}
