import { GoogleAuth } from 'google-auth-library';
import fs from 'node:fs';
import { GeminiAuthConfig } from '../config/geminiAuthConfig';
import { GeminiAuthError } from '../errors/GeminiAuthError';

export interface CachedOAuthToken {
  accessToken: string;
  expiresAt?: Date;
  principal?: string;
  projectId?: string;
}

export class OAuthTokenProvider {
  private auth?: GoogleAuth;
  private cached?: CachedOAuthToken;
  private readonly refreshSkewMs = 5 * 60 * 1000;

  constructor(private readonly config: GeminiAuthConfig) {}

  private getAuth(): GoogleAuth {
    if (!this.auth) {
      if (!this.config.GOOGLE_APPLICATION_CREDENTIALS) {
        throw new GeminiAuthError('GOOGLE_APPLICATION_CREDENTIALS is required for service account auth', 'MISSING_CREDENTIALS', false);
      }
      this.auth = new GoogleAuth({
        keyFile: this.config.GOOGLE_APPLICATION_CREDENTIALS,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
    }
    return this.auth;
  }

  private readPrincipal(): string | undefined {
    try {
      const p = this.config.GOOGLE_APPLICATION_CREDENTIALS;
      if (!p || !fs.existsSync(p)) return undefined;
      const json = JSON.parse(fs.readFileSync(p, 'utf8'));
      return json.client_email;
    } catch {
      return undefined;
    }
  }

  private isFresh(): boolean {
    if (!this.cached?.accessToken) return false;
    if (!this.cached.expiresAt) return true;
    return this.cached.expiresAt.getTime() - Date.now() > this.refreshSkewMs;
  }

  async getToken(forceRefresh = false): Promise<CachedOAuthToken> {
    if (!forceRefresh && this.isFresh()) return this.cached!;

    const auth = this.getAuth();
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;
    if (!accessToken) {
      throw new GeminiAuthError('GoogleAuth returned an empty access token', 'INVALID_CREDENTIALS', true);
    }

    const projectId = this.config.GOOGLE_CLOUD_PROJECT || await auth.getProjectId().catch(() => undefined);
    this.cached = {
      accessToken,
      // google-auth-library does not always expose expiry here. Use conservative 50m cache.
      expiresAt: new Date(Date.now() + 50 * 60 * 1000),
      principal: this.readPrincipal(),
      projectId,
    };
    return this.cached;
  }

  snapshot() {
    return {
      hasCachedToken: Boolean(this.cached?.accessToken),
      expiresAt: this.cached?.expiresAt?.toISOString(),
      principal: this.cached?.principal,
      projectId: this.cached?.projectId,
    };
  }
}
