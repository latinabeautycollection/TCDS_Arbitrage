import { getFedExEnv, FedExEnv } from "../config/fedexEnv";
import { FedExOAuthToken } from "../models/fedexTypes";

export class FedExClientError extends Error {
  constructor(message: string, public readonly statusCode?: number, public readonly responseBody?: unknown) {
    super(message);
    this.name = "FedExClientError";
  }
}

export class FedExClient {
  private tokenCache?: FedExOAuthToken & { cachedAtMs: number };

  constructor(private readonly env: FedExEnv = getFedExEnv()) {}

  async healthCheck(): Promise<{ ok: boolean; carrier: "FEDEX"; auth: boolean }> {
    if (!this.env.FEDEX_ENABLED) return { ok: false, carrier: "FEDEX", auth: false };
    const token = await this.getAccessToken();
    return { ok: Boolean(token.access_token), carrier: "FEDEX", auth: Boolean(token.access_token) };
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const token = await this.getAccessToken();
    return this.fetchWithRetry<T>(new URL(path, this.env.FEDEX_BASE_URL).toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  private async getAccessToken(): Promise<FedExOAuthToken> {
    const now = Date.now();
    if (this.tokenCache?.access_token && this.tokenCache.expires_in) {
      const refreshAt = this.tokenCache.cachedAtMs + Math.max(this.tokenCache.expires_in - this.env.FEDEX_TOKEN_REFRESH_SKEW_SECONDS, 60) * 1000;
      if (now < refreshAt) return this.tokenCache;
    }

    if (!this.env.FEDEX_CLIENT_ID || !this.env.FEDEX_CLIENT_SECRET) {
      throw new FedExClientError("FEDEX_CLIENT_ID or FEDEX_CLIENT_SECRET is missing.");
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.env.FEDEX_CLIENT_ID,
      client_secret: this.env.FEDEX_CLIENT_SECRET,
    });

    const token = await this.fetchWithRetry<FedExOAuthToken>(new URL(this.env.FEDEX_OAUTH_PATH, this.env.FEDEX_BASE_URL).toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    this.tokenCache = { ...token, cachedAtMs: now };
    return this.tokenCache;
  }

  private async fetchWithRetry<T>(url: string, init: RequestInit): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.env.FEDEX_MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.env.FEDEX_TIMEOUT_MS);

      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const contentType = response.headers.get("content-type") || "";
        const body = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();

        if (response.ok) return body as T;

        if (![429, 500, 502, 503, 504].includes(response.status) || attempt === this.env.FEDEX_MAX_RETRIES) {
          throw new FedExClientError(`FedEx API error ${response.status}`, response.status, body);
        }
      } catch (error) {
        lastError = error;
        if (attempt === this.env.FEDEX_MAX_RETRIES) break;
      } finally {
        clearTimeout(timeout);
      }

      await new Promise((resolve) => setTimeout(resolve, 750 * Math.pow(2, attempt)));
    }

    if (lastError instanceof Error) throw lastError;
    throw new FedExClientError("FedEx API request failed.");
  }
}
