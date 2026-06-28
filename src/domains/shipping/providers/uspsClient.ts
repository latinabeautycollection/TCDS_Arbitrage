import { getUspsEnv, UspsEnv } from "../config/uspsEnv";
import { UspsOAuthTokenResponse } from "../models/uspsTypes";
export class UspsClientError extends Error {
  constructor(message: string, public readonly statusCode?: number, public readonly responseBody?: unknown) {
    super(message); this.name = "UspsClientError";
  }
}
export class UspsClient {
  private tokenCache?: UspsOAuthTokenResponse & { cachedAtMs: number };
  constructor(private readonly env: UspsEnv = getUspsEnv()) {}
  async healthCheck(): Promise<{ ok: boolean; carrier: "USPS"; auth: boolean }> {
    if (!this.env.USPS_ENABLED) return { ok: false, carrier: "USPS", auth: false };
    const token = await this.getAccessToken();
    return { ok: Boolean(token.access_token), carrier: "USPS", auth: Boolean(token.access_token) };
  }
  async getJson<T>(path: string, query: Record<string, unknown> = {}): Promise<T> {
    const token = await this.getAccessToken();
    const url = new URL(path, this.env.USPS_BASE_URL);
    Object.entries(query).forEach(([k,v]) => { if (v !== undefined && v !== null && String(v).trim() !== "") url.searchParams.set(k, String(v)); });
    return this.fetchWithRetry<T>(url.toString(), { method: "GET", headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" } });
  }
  async postJson<T>(path: string, body: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const url = new URL(path, this.env.USPS_BASE_URL);
    return this.fetchWithRetry<T>(url.toString(), { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  private async getAccessToken(): Promise<UspsOAuthTokenResponse> {
    const now = Date.now();
    if (this.tokenCache?.access_token && this.tokenCache.expires_in) {
      const issuedAt = this.tokenCache.issued_at ?? this.tokenCache.cachedAtMs;
      if (now < issuedAt + Math.max(this.tokenCache.expires_in - this.env.USPS_TOKEN_REFRESH_SKEW_SECONDS, 60) * 1000) return this.tokenCache;
    }
    if (!this.env.USPS_CLIENT_ID || !this.env.USPS_CLIENT_SECRET) throw new UspsClientError("USPS_CLIENT_ID or USPS_CLIENT_SECRET is missing.");
    const body: Record<string, string> = { grant_type: "client_credentials", client_id: this.env.USPS_CLIENT_ID, client_secret: this.env.USPS_CLIENT_SECRET };
    if (this.env.USPS_OAUTH_SCOPE) body.scope = this.env.USPS_OAUTH_SCOPE;
    const token = await this.fetchWithRetry<UspsOAuthTokenResponse>(this.env.USPS_OAUTH_URL, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    this.tokenCache = { ...token, cachedAtMs: now };
    return this.tokenCache;
  }
  private async fetchWithRetry<T>(url: string, init: RequestInit): Promise<T> {
    let lastError: unknown;
    for (let attempt=0; attempt<=this.env.USPS_MAX_RETRIES; attempt++) {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.env.USPS_TIMEOUT_MS);
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const contentType = response.headers.get("content-type") || "";
        const body = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();
        if (response.ok) return body as T;
        if (![429,503].includes(response.status) || attempt === this.env.USPS_MAX_RETRIES) throw new UspsClientError(`USPS API error ${response.status}`, response.status, body);
      } catch (error) { lastError = error; if (attempt === this.env.USPS_MAX_RETRIES) break; }
      finally { clearTimeout(timeout); }
      await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
    }
    if (lastError instanceof Error) throw lastError;
    throw new UspsClientError("USPS API request failed.");
  }
}
