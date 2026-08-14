
import { Pool } from "pg";
import { DomainReleaseRepository } from "../repositories/domainReleaseRepository";
import { DomainReleaseWorker } from "./domainReleaseWorker";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const tenantId = process.env.DOMAIN8_SYSTEM_TENANT_ID;
  const actorId = process.env.DOMAIN8_SYSTEM_ACTOR_ID;
  if (!databaseUrl || !tenantId || !actorId) {
    throw new Error("Domain 8 release worker configuration is incomplete");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const worker = new DomainReleaseWorker(
    new DomainReleaseRepository(pool),
    process.env.DOMAIN8_8G_WORKER_ID ?? `domain8-8g-${process.pid}`,
  );

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await pool.end();
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  while (!stopped) {
    await worker.poll(tenantId, actorId);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
