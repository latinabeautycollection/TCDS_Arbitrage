
import type { Express } from "express";
import type { Pool } from "pg";
import { buildPostSaleDefenseRoutes } from "../routes/postSaleDefenseRoutes";
import { buildPostSaleHealthRoutes } from "../routes/postSaleHealthRoutes";
import { PostSaleGateRepository } from "../repositories/postSaleGateRepository";
import { PostSaleGateWorker } from "../workers/postSaleGateWorker";
import { noOpPostSaleDefenseMetrics } from "../observability/postSaleDefenseMetrics";
import { loadPostSaleDefenseConfig } from "../config/postSaleDefenseConfig";

export interface PostSaleDefenseRuntime {
  stop(): Promise<void>;
}

export function mountPostSaleDefense(
  app: Express,
  pool: Pool,
): PostSaleDefenseRuntime {
  const config = loadPostSaleDefenseConfig();
  if (!config.enabled) {
    return { stop: async () => undefined };
  }

  app.use(buildPostSaleDefenseRoutes(pool));
  app.use(buildPostSaleHealthRoutes(pool));

  let timer: NodeJS.Timeout | undefined;
  if (config.workerEnabled) {
    const repository = new PostSaleGateRepository(pool);
    const worker = new PostSaleGateWorker(
      repository,
      noOpPostSaleDefenseMetrics,
      config.workerId,
      config.batchSize,
      config.leaseSeconds,
      config.heartbeatSeconds,
    );

    timer = setInterval(() => {
      const tenantId = process.env.DOMAIN8_SYSTEM_TENANT_ID;
      const actorId = process.env.DOMAIN8_SYSTEM_ACTOR_ID;
      if (tenantId && actorId) {
        void worker.poll(tenantId, actorId);
      }
    }, config.pollIntervalMs);
  }

  return {
    stop: async () => {
      if (timer) clearInterval(timer);
    },
  };
}
