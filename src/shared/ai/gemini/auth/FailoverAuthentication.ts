import { GeminiAuthProvider, GeminiAccessToken } from './GeminiAuthTypes';

export class FailoverAuthentication {
  constructor(private readonly providers: GeminiAuthProvider[]) {}
  async getToken(): Promise<GeminiAccessToken> {
    const errors: string[] = [];
    for (const p of this.providers) {
      try { if (await p.canUse()) return await p.getToken(); } catch (e: any) { errors.push(`${p.mode}: ${e?.message ?? String(e)}`); }
    }
    throw new Error(`All Gemini authentication providers failed: ${errors.join('; ')}`);
  }
}
