
export interface PostSaleDefenseConfig {
  enabled: boolean;
  workerEnabled: boolean;
  workerId: string;
  pollIntervalMs: number;
  batchSize: number;
  leaseSeconds: number;
  heartbeatSeconds: number;
}

export function loadPostSaleDefenseConfig(): PostSaleDefenseConfig {
  return {
    enabled: process.env.DOMAIN8_POST_SALE_ENABLED === "true",
    workerEnabled: process.env.DOMAIN8_POST_SALE_WORKER_ENABLED === "true",
    workerId: process.env.DOMAIN8_POST_SALE_WORKER_ID ?? `post-sale-${process.pid}`,
    pollIntervalMs: Number(process.env.DOMAIN8_POST_SALE_POLL_MS ?? 5000),
    batchSize: Number(process.env.DOMAIN8_POST_SALE_BATCH_SIZE ?? 25),
    leaseSeconds: Number(process.env.DOMAIN8_POST_SALE_LEASE_SECONDS ?? 300),
    heartbeatSeconds: Number(process.env.DOMAIN8_POST_SALE_HEARTBEAT_SECONDS ?? 60),
  };
}
