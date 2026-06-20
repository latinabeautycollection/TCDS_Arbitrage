import crypto from "node:crypto";
import { Pool } from "pg";
import { createLogger, serializeError } from "../services/logger";
import { CapitalSafetyRepository } from "../repositories/capitalSafetyRepository";
import { evaluateCapitalSafetyGate } from "../services/capitalSafetyGate.service";
import { ForensicLedgerService } from "../services/forensicLedger.service";

const config = {
  workerName: env("PHASE2_HARDENING_WORKER_NAME", "phase2-hardening-worker"),
  workerInstanceId: env(
    "PHASE2_HARDENING_WORKER_INSTANCE_ID",
    crypto.randomUUID(),
  ),
  loopDelayMs: intEnv("PHASE2_HARDENING_LOOP_DELAY_MS", 1000),
  idleSleepMs: intEnv("PHASE2_HARDENING_IDLE_SLEEP_MS", 30000),
  heartbeatIntervalMs: intEnv("PHASE2_HARDENING_HEARTBEAT_INTERVAL_MS", 30000),
  batchSize: intEnv("PHASE2_HARDENING_BATCH_SIZE", 50),
  claimTtlSeconds: intEnv("PHASE2_HARDENING_CLAIM_TTL_SECONDS", 300),
};

const logger = createLogger({
  serviceName: env("APP_SERVICE_NAME", "arb-system-api"),
  staticBindings: {
    component: "phase2HardeningWorker",
    workerName: config.workerName,
    workerInstanceId: config.workerInstanceId,
  },
});
const pool = new Pool({
  connectionString: requiredEnv("DATABASE_URL"),
  max: intEnv("PG_POOL_MAX", 10),
  idleTimeoutMillis: intEnv("PG_IDLE_TIMEOUT_MS", 30000),
  connectionTimeoutMillis: intEnv("PG_CONNECTION_TIMEOUT_MS", 10000),
  statement_timeout: intEnv("PG_STATEMENT_TIMEOUT_MS", 30000),
  query_timeout: intEnv("PG_QUERY_TIMEOUT_MS", 30000),
  application_name: `${config.workerName}:${config.workerInstanceId}`,
  ssl: boolEnv("PG_SSL_ENABLED", true) ? { rejectUnauthorized: false } : false,
} as Record<string, unknown>);
const repository = new CapitalSafetyRepository(pool, logger);
const ledger = new ForensicLedgerService(pool);

export async function runPhase2HardeningWorker(
  signal?: AbortSignal,
): Promise<void> {
  let running = true;
  let lastHeartbeat = 0;
  const stop = (): void => {
    running = false;
    logger.warn("stop requested", { operation: "runPhase2HardeningWorker" });
  };
  signal?.addEventListener("abort", stop);
  await heartbeat("starting", { phase: "boot" });

  try {
    while (running) {
      if (Date.now() - lastHeartbeat >= config.heartbeatIntervalMs) {
        await heartbeat("running", { phase: "claiming_safety_opportunities" });
        lastHeartbeat = Date.now();
      }

      const policy = await repository.getActivePolicy();
      const claimed = await repository.claimSafetyOpportunities({
        workerId: config.workerInstanceId,
        batchSize: config.batchSize,
        claimTtlSeconds: config.claimTtlSeconds,
      });
      if (claimed.length === 0) {
        await sleep(config.idleSleepMs);
        continue;
      }

      for (const item of claimed) {
        if (!running) break;
        const correlationId = crypto.randomUUID();
        try {
          await heartbeat("processing", {
            phase: "capital_safety_gate",
            listingId: item.listingId,
            candidateId: item.candidateId,
            opportunityQueueId: item.opportunityQueueId,
            correlationId,
          });
          const ledgerContinuityOk = await ledger.verifyContinuity(
            "listing",
            item.listingId,
          );
          const decisionInput = {
            listingId: item.listingId,
            candidateId: item.candidateId,
            opportunityQueueId: item.opportunityQueueId,
            decisionId: item.decisionId,
            decision: item.decision,
            expectedProfitUsd: item.expectedProfitUsd,
            roiPct: item.roiPct,
            priorityScore: item.priorityScore,
            riskScore: item.riskScore,
            identityConfidence: item.identityConfidence,
            soldCount: item.soldCount,
            activeCount: item.activeCount,
            activeToSoldRatio: item.activeToSoldRatio,
            compGroundingScore: item.compGroundingScore,
            replayStatus: "NOT_RUN" as const,
            ledgerContinuityOk,
            reasonCodes: [],
            riskFlags: [],
            correlationId,
            // Phase 2.9 spec
            profitAnalysisDecisionCode: item.profitAnalysisDecisionCode,
            dedupeGateStatus: item.dedupeGateStatus,
            reviewRequired: item.reviewRequired,
            isBundle: item.isBundle,
            candidateTitle: item.candidateTitle,
            totalCostBasisUsd: item.totalCostBasisUsd,
            endTime: item.endTime,
          };
          const result = evaluateCapitalSafetyGate(decisionInput, policy);
          await repository.persistSafetyAssessment({
            decisionInput,
            policy,
            result,
          });
          await ledger.append({
            correlationId,
            entityType: "listing",
            entityId: item.listingId,
            mutationType: "CAPITAL_SAFETY_ASSESSMENT",
            actor: config.workerName,
            after: result,
            payload: decisionInput,
          });
          logger.info("capital safety assessed", {
            operation: "runPhase2HardeningWorker",
            listingId: item.listingId,
            decision: item.decision,
            allowedDecision: result.allowedDecision,
            assessmentStatus: result.assessmentStatus,
            gateReasonCodes: result.gateReasonCodes,
            correlationId,
          });
          await sleep(config.loopDelayMs);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await heartbeat("degraded", {
            phase: "error",
            listingId: item.listingId,
            errorCode: "CAPITAL_SAFETY_ASSESSMENT_FAILED",
            errorMessage: message,
            correlationId,
          });
          await repository.insertDeadLetter({
            workerName: config.workerName,
            entityType: "opportunity_queue",
            entityId: String(item.opportunityQueueId),
            failureCode: "CAPITAL_SAFETY_ASSESSMENT_FAILED",
            failureMessage: message,
            payload: { item, error: serializeError(error) },
          });
          logger.error("capital safety item failed", {
            operation: "runPhase2HardeningWorker",
            item,
            error: serializeError(error),
          });
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", stop);
    await heartbeat("stopped", { phase: "shutdown" });
    await pool.end();
  }
}

async function heartbeat(
  status: string,
  details: Record<string, unknown>,
): Promise<void> {
  await repository.writeHeartbeat({
    workerName: config.workerName,
    workerInstanceId: config.workerInstanceId,
    status,
    details,
  });
}
function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}
function intEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}
function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  return raw
    ? ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase())
    : fallback;
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

if (require.main === module) {
  const ac = new AbortController();
  process.on("SIGINT", () => ac.abort());
  process.on("SIGTERM", () => ac.abort());
  runPhase2HardeningWorker(ac.signal).catch((error) => {
    logger.error("phase2 hardening worker crashed", {
      operation: "processExit",
      error: serializeError(error),
    });
    process.exit(1);
  });
}
