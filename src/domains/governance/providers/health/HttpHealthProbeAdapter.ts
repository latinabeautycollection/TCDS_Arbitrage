import { HealthError } from "../../errors/HealthError";
import type { HealthCheckDefinition, HealthProbeResult } from "../../models/healthTypes";
import type { HealthProbeAdapter, HealthProbeExecutionContext } from "./HealthProbeAdapter";

interface HttpProbeConfig {
  url: string;
  method?: "GET" | "HEAD";
  expectedStatus?: number[];
}

function configOf(definition: HealthCheckDefinition): HttpProbeConfig {
  const c = definition.configuration as Record<string, unknown>;
  const url = String(c.url ?? "");
  if (!/^https?:\/\//i.test(url)) throw new HealthError("HEALTH_HTTP_CONFIG_INVALID", "HTTP health URL must use http/https", false);
  const parsed = new URL(url);
  if (parsed.username || parsed.password) throw new HealthError("HEALTH_HTTP_CREDENTIALS_FORBIDDEN", "Credentials may not be embedded in health URLs", false);
  if (parsed.search || parsed.hash) throw new HealthError("HEALTH_HTTP_QUERY_FORBIDDEN", "Built-in health URLs may not contain query strings or fragments", false);
  const method = (c.method ?? "GET") as "GET" | "HEAD";
  if (!(["GET", "HEAD"] as const).includes(method)) throw new HealthError("HEALTH_HTTP_METHOD_INVALID", "Only GET/HEAD health probes are allowed", false);
  const expectedStatus = Array.isArray(c.expectedStatus) ? c.expectedStatus.map(Number) : [200];
  if (!expectedStatus.length || expectedStatus.some((n) => !Number.isInteger(n) || n < 100 || n > 599)) {
    throw new HealthError("HEALTH_HTTP_STATUS_INVALID", "expectedStatus must contain HTTP status codes", false);
  }
  return { url, method, expectedStatus };
}

export class HttpHealthProbeAdapter implements HealthProbeAdapter {
  readonly kind = "HTTP" as const;
  constructor(private readonly allowedHosts: readonly string[]) {}

  private assertAllowed(url: string): void {
    const host = new URL(url).hostname.toLowerCase();
    if (!this.allowedHosts.length) throw new HealthError("HEALTH_HTTP_ALLOWLIST_EMPTY", "HTTP probes are disabled until DOMAIN11B_HTTP_ALLOWED_HOSTS is configured", false);
    const allowed = this.allowedHosts.some((entry) => entry.startsWith("*.") ? host.endsWith(entry.slice(1)) && host !== entry.slice(2) : host === entry);
    if (!allowed) throw new HealthError("HEALTH_HTTP_HOST_NOT_ALLOWED", `Health probe host is not allowlisted: ${host}`, false);
  }

  async execute(definition: HealthCheckDefinition, context: HealthProbeExecutionContext): Promise<HealthProbeResult> {
    const config = configOf(definition);
    this.assertAllowed(config.url);
    const started = performance.now();
    try {
      const response = await fetch(config.url, {
        method: config.method,
        signal: context.signal,
        redirect: "manual",
        headers: { "accept": "application/json,text/plain;q=0.9,*/*;q=0.1", "user-agent": "TCDS-Domain11B-Health/1.0" },
      });
      const latencyMs = Math.max(0, Math.round(performance.now() - started));
      const ok = config.expectedStatus!.includes(response.status);
      return {
        outcome: ok ? "SUCCESS" : "FAILURE",
        latencyMs,
        evidence: { status: response.status, statusText: response.statusText, finalUrl: response.url || config.url },
        errorCode: ok ? undefined : "HTTP_STATUS_UNEXPECTED",
      };
    } catch (error) {
      const latencyMs = Math.max(0, Math.round(performance.now() - started));
      const aborted = context.signal.aborted;
      return {
        outcome: "FAILURE",
        latencyMs,
        evidence: { aborted, errorName: error instanceof Error ? error.name : "UnknownError" },
        errorCode: aborted ? "HEALTH_CHECK_TIMEOUT" : "HEALTH_HTTP_REQUEST_FAILED",
      };
    }
  }
}
