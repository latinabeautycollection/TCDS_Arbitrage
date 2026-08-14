
import crypto from "node:crypto";
import { Pool } from "pg";
import { PostSaleGateRepository } from "../repositories/postSaleGateRepository";
import { PostSaleGateWorker } from "./postSaleGateWorker";
import { noOpPostSaleDefenseMetrics } from "../observability/postSaleDefenseMetrics";
import { loadPostSaleDefenseConfig } from "../config/postSaleDefenseConfig";
import { returnDefenseLogger } from "../observability/returnDefenseLogger";

async function main(): Promise<void> {
  const config = loadPostSaleDefenseConfig();
  const connectionString = process.env.DATABASE_URL;
  const tenantId = process.env.DOMAIN8_SYSTEM_TENANT_ID;
  const actorId = process.env.DOMAIN8_SYSTEM_ACTOR_ID;

  if (!connectionString || !tenantId || !actorId) {
    throw new Error("DATABASE_URL and Domain 8 system identity are required");
  }

  const pool = new Pool({ connectionString });
  const worker = new PostSaleGateWorker(
    new PostSaleGateRepository(pool),
    noOpPostSaleDefenseMetrics,
    config.workerId,
    config.batchSize,
    config.leaseSeconds,
    config.heartbeatSeconds,
  );

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await pool.end();
  };

  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());

  while (!stopped) {
    try {
      await worker.poll(tenantId, actorId);
    } catch (error) {
      returnDefenseLogger.error(
        { error, correlationId: crypto.randomUUID() },
        "post-sale worker polling failed",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

void main().catch((error) => {
  returnDefenseLogger.fatal({ error }, "post-sale worker failed to start");
  process.exitCode = 1;
});
