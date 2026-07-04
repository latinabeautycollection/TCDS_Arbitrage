import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { GeminiAuthConfig } from '../config/geminiAuthConfig';
import { GeminiAuthProvider, GeminiAccessToken, GeminiCredentialHealth } from './GeminiAuthTypes';

export class ServiceAccountAuthentication implements GeminiAuthProvider {
  readonly mode: GeminiAccessToken['authMode'] = 'SERVICE_ACCOUNT';
  private auth?: GoogleAuth;

  constructor(private readonly config: GeminiAuthConfig) {}

  canUse(): boolean {
    return Boolean(this.config.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(this.config.GOOGLE_APPLICATION_CREDENTIALS));
  }

  private getAuth(): GoogleAuth {
    if (!this.auth) {
      this.auth = new GoogleAuth({
        keyFile: this.config.GOOGLE_APPLICATION_CREDENTIALS,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
    }
    return this.auth;
  }

  async getToken(): Promise<GeminiAccessToken> {
    const client = await this.getAuth().getClient();
    const token = await client.getAccessToken();
    const projectId = this.config.GOOGLE_CLOUD_PROJECT || await this.getAuth().getProjectId().catch(() => undefined);
    const key = JSON.parse(fs.readFileSync(this.config.GOOGLE_APPLICATION_CREDENTIALS!, 'utf8'));
    return {
      accessToken: token.token || undefined,
      authMode: this.mode,
      projectId,
      location: this.config.GOOGLE_CLOUD_LOCATION,
      principal: key.client_email,
    };
  }

  async healthCheck(): Promise<GeminiCredentialHealth> {
    try {
      const token = await this.getToken();
      return { healthy: Boolean(token.accessToken), mode: this.mode, principal: token.principal, projectId: token.projectId, checkedAt: new Date().toISOString() };
    } catch (e: any) {
      return { healthy: false, mode: this.mode, reason: e?.message ?? String(e), checkedAt: new Date().toISOString() };
    }
  }
}
