import { getShipEngineEnv, ShipEngineEnv } from "../config/shipEngineEnv";

export class ShipEngineClientError extends Error {
  constructor(message: string, public readonly statusCode?: number, public readonly responseBody?: unknown) {
    super(message);
    this.name = "ShipEngineClientError";
  }
}

export class ShipEngineClient {
  constructor(private readonly env: ShipEngineEnv = getShipEngineEnv()) {}

  async healthCheck(): Promise<{ ok: boolean; carrier: "SHIPENGINE"; apiKey: boolean; environment: string }> {
    return {
      ok: this.env.SHIPENGINE_ENABLED && Boolean(this.env.SHIPENGINE_API_KEY),
      carrier: "SHIPENGINE",
      apiKey: Boolean(this.env.SHIPENGINE_API_KEY),
      environment: this.env.SHIPENGINE_ENVIRONMENT,
    };
  }

  get<T>(path: string, query: Record<string, unknown> = {}) {
    return this.request<T>("GET", path, undefined, query);
  }

  post<T>(path: string, body?: unknown, query: Record<string, unknown> = {}) {
    return this.request<T>("POST", path, body, query);
  }

  put<T>(path: string, body?: unknown, query: Record<string, unknown> = {}) {
    return this.request<T>("PUT", path, body, query);
  }

  patch<T>(path: string, body?: unknown, query: Record<string, unknown> = {}) {
    return this.request<T>("PATCH", path, body, query);
  }

  delete<T>(path: string, query: Record<string, unknown> = {}) {
    return this.request<T>("DELETE", path, undefined, query);
  }

  private async request<T>(method: string, path: string, body?: unknown, query: Record<string, unknown> = {}): Promise<T> {
    const key = this.env.SHIPENGINE_API_KEY;
    if (!key) throw new ShipEngineClientError("SHIPENGINE_API_KEY missing.");

    const base = this.env.SHIPENGINE_BASE_URL.endsWith("/") ? this.env.SHIPENGINE_BASE_URL : `${this.env.SHIPENGINE_BASE_URL}/`;
    const url = new URL(path.replace(/^\//, ""), base);
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== "") url.searchParams.set(k, String(v));
    });

    const response = await fetch(url.toString(), {
      method,
      headers: {
        "API-Key": key,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 204) return {} as T;

    const contentType = response.headers.get("content-type") || "";
    const responseBody = contentType.includes("json") ? await response.json().catch(() => ({})) : await response.text();

    if (!response.ok) {
      throw new ShipEngineClientError(`ShipEngine API error ${response.status}`, response.status, responseBody);
    }
    return responseBody as T;
  }
}
