import { getDhlEnv, DhlEnv } from "../config/dhlEnv";

export class DhlClientError extends Error {
  constructor(message: string, public readonly statusCode?: number, public readonly responseBody?: unknown) {
    super(message);
    this.name = "DhlClientError";
  }
}

export class DhlClient {
  constructor(private readonly env: DhlEnv = getDhlEnv()) {}

  async healthCheck(): Promise<{ ok: boolean; carrier: "DHL"; apiKey: boolean; environment: string }> {
    return {
      ok: this.env.DHL_ENABLED && Boolean(this.apiKey("TRACKING")),
      carrier: "DHL",
      apiKey: Boolean(this.apiKey("TRACKING")),
      environment: this.env.DHL_ENVIRONMENT,
    };
  }

  async getTracking<T>(path: string, query: Record<string, unknown> = {}): Promise<T> {
    return this.getJson<T>(this.trackingBaseUrl(), path, query, this.apiKey("TRACKING"));
  }

  async getLocation<T>(path: string, query: Record<string, unknown> = {}): Promise<T> {
    return this.getJson<T>(this.env.DHL_LOCATION_BASE_URL, path, query, this.apiKey("LOCATION"));
  }

  async getEcommerce<T>(path: string, query: Record<string, unknown> = {}): Promise<T> {
    return this.getJson<T>(this.ecommerceBaseUrl(), path, query, this.apiKey("ECOMMERCE"));
  }

  async postEcommerce<T>(path: string, body: unknown): Promise<T> {
    return this.writeJson<T>("POST", this.ecommerceBaseUrl(), path, body, this.apiKey("ECOMMERCE"));
  }

  async putEcommerce<T>(path: string, body: unknown): Promise<T> {
    return this.writeJson<T>("PUT", this.ecommerceBaseUrl(), path, body, this.apiKey("ECOMMERCE"));
  }

  async deleteEcommerce<T>(path: string): Promise<T> {
    return this.writeJson<T>("DELETE", this.ecommerceBaseUrl(), path, undefined, this.apiKey("ECOMMERCE"));
  }

  async postFreightPriceQuote<T>(body: unknown): Promise<T> {
    return this.writeJson<T>("POST", this.freightPriceQuoteBaseUrl(), "/pricequote/quoteforprice", body, this.env.DHL_FREIGHT_API_KEY);
  }

  async postFreightBooking<T>(body: unknown): Promise<T> {
    return this.writeJson<T>("POST", this.freightBookingBaseUrl(), "/sendtransportinstruction", body, this.env.DHL_FREIGHT_API_KEY);
  }

  private async getJson<T>(baseUrl: string, path: string, query: Record<string, unknown>, key?: string): Promise<T> {
    if (!key) throw new DhlClientError("DHL API key missing.");
    const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== "") url.searchParams.set(k, String(v));
    });
    return this.fetchJson<T>(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json", "DHL-API-Key": key },
    });
  }

  private async writeJson<T>(method: string, baseUrl: string, path: string, body: unknown, key?: string): Promise<T> {
    if (!key) throw new DhlClientError("DHL API key missing.");
    const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    return this.fetchJson<T>(url.toString(), {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", "DHL-API-Key": key },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("json") ? await response.json().catch(() => ({})) : await response.text();
    if (!response.ok) throw new DhlClientError(`DHL API error ${response.status}`, response.status, body);
    return body as T;
  }

  private apiKey(area: "TRACKING" | "LOCATION" | "ECOMMERCE"): string | undefined {
    if (area === "TRACKING") return this.env.DHL_TRACKING_API_KEY || this.env.DHL_API_KEY;
    if (area === "LOCATION") return this.env.DHL_LOCATION_API_KEY || this.env.DHL_API_KEY;
    return this.env.DHL_ECOMMERCE_API_KEY || this.env.DHL_API_KEY;
  }

  private trackingBaseUrl(): string {
    return this.env.DHL_ENVIRONMENT === "test" ? this.env.DHL_TRACKING_TEST_BASE_URL : this.env.DHL_TRACKING_BASE_URL;
  }

  private ecommerceBaseUrl(): string {
    return this.env.DHL_ENVIRONMENT === "sandbox" ? this.env.DHL_ECOMMERCE_SANDBOX_BASE_URL : this.env.DHL_ECOMMERCE_BASE_URL;
  }

  private freightPriceQuoteBaseUrl(): string {
    return this.env.DHL_ENVIRONMENT === "sandbox" ? this.env.DHL_FREIGHT_PRICEQUOTE_SANDBOX_BASE_URL : this.env.DHL_FREIGHT_PRICEQUOTE_BASE_URL;
  }

  private freightBookingBaseUrl(): string {
    return this.env.DHL_ENVIRONMENT === "sandbox" ? this.env.DHL_FREIGHT_BOOKING_SANDBOX_BASE_URL : this.env.DHL_FREIGHT_BOOKING_BASE_URL;
  }
}
