import { GeminiAuthProvider } from './GeminiAuthTypes';

export class TokenRefreshMonitor {
  private lastRefreshAt?: Date;
  private lastFailure?: string;
  constructor(private readonly provider: GeminiAuthProvider) {}
  async refresh() {
    try {
      const token = await this.provider.getToken();
      this.lastRefreshAt = new Date();
      this.lastFailure = undefined;
      return token;
    } catch (e: any) {
      this.lastFailure = e?.message ?? String(e);
      throw e;
    }
  }
  snapshot() { return { mode: this.provider.mode, lastRefreshAt: this.lastRefreshAt?.toISOString(), lastFailure: this.lastFailure }; }
}
