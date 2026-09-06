export interface HealthWorkerConfig {
  workerId: string;
  pollIntervalMs: number;
  claimLimit: number;
  leaseSeconds: number;
  maxConcurrentChecks: number;
  httpAllowedHosts: readonly string[];
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function loadHealthWorkerConfig(): HealthWorkerConfig {
  const workerId = (process.env.DOMAIN11B_WORKER_ID ?? `health-${process.pid}`).trim();
  if (!workerId) throw new Error("DOMAIN11B_WORKER_ID must not be blank");
  return {
    workerId,
    pollIntervalMs: intEnv("DOMAIN11B_POLL_INTERVAL_MS", 5000, 1000, 60000),
    claimLimit: intEnv("DOMAIN11B_CLAIM_LIMIT", 25, 1, 500),
    leaseSeconds: intEnv("DOMAIN11B_LEASE_SECONDS", 60, 10, 600),
    maxConcurrentChecks: intEnv("DOMAIN11B_MAX_CONCURRENT_CHECKS", 10, 1, 100),
    httpAllowedHosts: (process.env.DOMAIN11B_HTTP_ALLOWED_HOSTS ?? "").split(",").map((x)=>x.trim().toLowerCase()).filter(Boolean),
  };
}
