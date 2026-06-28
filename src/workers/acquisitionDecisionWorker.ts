import crypto from 'node:crypto';
import { Pool } from 'pg';
import {
  AcquisitionDecisionRepository,
  hashAcquisitionInput,
} from '../repositories/acquisitionDecisionRepository';
import { resolveAcquisitionIdentity } from '../services/acquisitionIdentity';
import { buildAcquisitionCompSet } from '../services/acquisitionCompSelection';
import { computeAcquisitionMarketProfile } from '../services/acquisitionMarketAnalytics';
import { buildAcquisitionFinancialModel } from '../services/acquisitionFinancialModel';
import { evaluateAcquisitionRules } from '../services/acquisitionRulesEngine';
import { allocateAcquisitionPortfolio } from '../services/acquisitionAllocator';
import {
  incAcqCounter,
  setAcqGauge,
} from '../services/acquisitionDecisionMetrics';
import {
  createAcquisitionLogger,
  serializeAcquisitionError,
} from '../services/acquisitionLogger';
import { evaluateCapitalSafety } from '../services/capitalSafetyBridge';
import type {
  AcquisitionCandidate,
  AcquisitionDecisionStatus,
  AcquisitionExecutionStatus,
  CapitalSafetyStatus,
  EconomicRuleEvaluation,
  PurchaseQueueStatus,
  RawSafetyEvaluation,
  RuleEvaluation,
  SafetyEvaluation,
  ScoredAcquisitionDecision,
} from '../contracts/acquisitionDecision';
import {
  createScoredDecision,
  isPurchaseQueueEligible,
  makeSafetyEvaluation,
  preserveBuySignalWithExecution,
  resolveExecutionStatus,
  resolvePurchaseQueueStatus,
  splitCapitalReasons,
  uniqueStrings,
} from '../contracts/acquisitionDecision';

/**
 * Domain 1 — Acquisition Decision Worker
 * Green Tier 1 Production Worker
 *
 * Mission:
 *   Convert Phase 2 opportunities into durable Domain 1 acquisition decisions while
 *   preserving the original economic BUY signal and separately resolving execution
 *   eligibility.
 *
 * Critical operating rules:
 *   1. A BUY signal is never silently downgraded to REVIEW.
 *   2. Hard blockers stop execution: BLOCKED / EXPIRED / CAPITAL_LIMIT_SKIPPED.
 *   3. Soft blockers route execution into purchase_queue as REVIEW_REQUIRED or BID_MONITOR_READY.
 *   4. AUTO_BUY_READY, BID_MONITOR_READY, and REVIEW_REQUIRED must be persisted by the repository
 *      so capital allocation / purchase queue handoff is observable and actionable.
 */

const config = {
  workerName: env('ACQ_DECISION_WORKER_NAME', 'acquisition-decision-worker'),
  workerInstanceId: env('ACQ_DECISION_WORKER_INSTANCE_ID', crypto.randomUUID()),
  batchSize: intEnv('ACQ_DECISION_WORKER_BATCH_SIZE', 25),
  claimTtlSeconds: intEnv('ACQ_DECISION_WORKER_CLAIM_TTL_SECONDS', 600),
  idleSleepMs: intEnv('ACQ_DECISION_WORKER_IDLE_SLEEP_MS', 15_000),
  loopDelayMs: intEnv('ACQ_DECISION_WORKER_LOOP_DELAY_MS', 1_000),
  heartbeatIntervalMs: intEnv('ACQ_DECISION_WORKER_HEARTBEAT_INTERVAL_MS', 30_000),
  maxAttempts: intEnv('ACQ_DECISION_WORKER_MAX_ATTEMPTS', 5),
  policyVersion: env('ACQ_POLICY_VERSION', 'acq-domain1-schema-v3'),
  cashOnHandUsd: floatEnv('ACQ_DEFAULT_CASH_ON_HAND_USD', 10_000),
  enableSingleRun: boolEnv('ACQ_DECISION_WORKER_SINGLE_RUN', false),
};

const logger = createAcquisitionLogger({
  component: 'acquisitionDecisionWorker',
  workerName: config.workerName,
  workerInstanceId: config.workerInstanceId,
});

const pool = new Pool({
  connectionString: requiredEnv('DATABASE_URL'),
  max: intEnv('PG_POOL_MAX', 10),
  idleTimeoutMillis: intEnv('PG_IDLE_TIMEOUT_MS', 30_000),
  connectionTimeoutMillis: intEnv('PG_CONNECTION_TIMEOUT_MS', 10_000),
  statement_timeout: intEnv('PG_STATEMENT_TIMEOUT_MS', 30_000),
  query_timeout: intEnv('PG_QUERY_TIMEOUT_MS', 30_000),
  application_name: `${config.workerName}:${config.workerInstanceId}`,
  ssl: boolEnv('PG_SSL_ENABLED', true) ? { rejectUnauthorized: false } : false,
} as Record<string, unknown>);

const repository = new AcquisitionDecisionRepository(pool, logger);

export async function runAcquisitionDecisionWorker(signal?: AbortSignal): Promise<void> {
  let keepRunning = true;
  let lastHeartbeatAt = 0;

  const stop = (): void => {
    keepRunning = false;
    logger.warn('stop requested', { operation: 'runAcquisitionDecisionWorker' });
  };

  signal?.addEventListener('abort', stop);
  await heartbeat('starting', { phase: 'boot' });

  try {
    while (keepRunning) {
      const loopStartedAt = Date.now();

      if (Date.now() - lastHeartbeatAt >= config.heartbeatIntervalMs) {
        await heartbeat('running', { phase: 'claiming' });
        lastHeartbeatAt = Date.now();
      }

      const candidates = await repository.claimOpportunityBatch({
        workerId: config.workerInstanceId,
        workerName: config.workerName,
        batchSize: config.batchSize,
        claimTtlSeconds: config.claimTtlSeconds,
        maxAttempts: config.maxAttempts,
      });

      setAcqGauge('acq_latest_claimed_batch_size', candidates.length);

      if (candidates.length === 0) {
        await heartbeat('idle', { phase: 'no_claimable_opportunities' });
        if (config.enableSingleRun) break;
        await sleep(config.idleSleepMs);
        continue;
      }

      const portfolioBatchId = crypto.randomUUID();
      const scored: ScoredAcquisitionDecision[] = [];

      await heartbeat('processing', {
        phase: 'scoring_batch',
        portfolioBatchId,
        batchSize: candidates.length,
      });

      for (const candidate of candidates) {
        const correlationId = crypto.randomUUID();
        const itemLogger = logger.child({
          correlationId,
          portfolioBatchId,
          listingId: candidate.listingId,
          candidateId: candidate.candidateId,
          opportunityQueueId: candidate.opportunityQueueId,
        });

        try {
          const decision = await scoreCandidate({
            candidate,
            correlationId,
            portfolioBatchId,
          });

          scored.push(decision);

          itemLogger.info('acquisition candidate scored', {
            operation: 'scoreCandidate',
            originalDecision: decision.originalRules.status,
            finalDecision: decision.finalRules.status,
            executionStatus: decision.executionStatus,
            purchaseQueueStatus: decision.purchaseQueueStatus,
            purchaseQueueEligible: decision.purchaseQueueEligible,
            capitalStatus: decision.safety.status,
            hardBlockReasons: decision.safety.hardBlockReasons,
            softReviewReasons: decision.safety.softReviewReasons,
            priorityScore: decision.finalRules.priorityScore,
            profit: decision.financial.estimatedProfitUsd,
            roi: decision.financial.estimatedRoi,
            safetyScore: decision.safety.safetyScore,
          });

          incAcqCounter('acq_decision_candidates_scored_total');
          incAcqCounter(`acq_decision_original_${decision.originalRules.status.toLowerCase()}_total`);
          incAcqCounter(`acq_decision_execution_${decision.executionStatus.toLowerCase()}_total`);
        } catch (error) {
          await handleCandidateFailure({
            candidate,
            correlationId,
            portfolioBatchId,
            error,
          });
        }
      }

      if (scored.length > 0) {
        const allocation = allocateAcquisitionPortfolio({
          decisions: scored,
          cashOnHandUsd: config.cashOnHandUsd,
        });

        const hardenedAllocatedDecisions = allocation.decisions.map((decision) => hardenAllocatedDecision(decision));

        await repository.persistDecisionBatch(hardenedAllocatedDecisions);

        const rollup = summarizeDecisions(hardenedAllocatedDecisions);

        incAcqCounter('acq_decisions_processed_total', hardenedAllocatedDecisions.length);
        incAcqCounter('acq_decisions_original_buy_total', rollup.originalBuyCount);
        incAcqCounter('acq_decisions_purchase_queue_eligible_total', rollup.purchaseQueueEligibleCount);
        incAcqCounter('acq_decisions_hard_blocked_total', rollup.hardBlockedCount);
        incAcqCounter('acq_decisions_review_required_total', rollup.reviewRequiredCount);
        incAcqCounter('acq_decisions_bid_monitor_ready_total', rollup.bidMonitorReadyCount);
        incAcqCounter('acq_decisions_auto_buy_ready_total', rollup.autoBuyReadyCount);
        incAcqCounter('acq_decisions_capital_limit_skipped_total', rollup.capitalLimitSkippedCount);

        setAcqGauge('acq_allocated_capital_usd', allocation.allocatedCapitalUsd);
        setAcqGauge('acq_remaining_capital_usd', allocation.remainingCapitalUsd);
        setAcqGauge('acq_latest_batch_size', hardenedAllocatedDecisions.length);
        setAcqGauge('acq_decision_batch_latency_ms', Date.now() - loopStartedAt);
        setAcqGauge('acq_capital_skipped_count', allocation.skippedForCapitalCount);
        setAcqGauge('acq_purchase_queue_eligible_count', rollup.purchaseQueueEligibleCount);
        setAcqGauge('acq_hard_blocked_count', rollup.hardBlockedCount);

        logger.info('acquisition decision batch completed', {
          operation: 'runAcquisitionDecisionWorker',
          portfolioBatchId,
          processed: hardenedAllocatedDecisions.length,
          allocatedCapitalUsd: allocation.allocatedCapitalUsd,
          remainingCapitalUsd: allocation.remainingCapitalUsd,
          skippedForCapitalCount: allocation.skippedForCapitalCount,
          rollup,
          durationMs: Date.now() - loopStartedAt,
        });
      }

      if (config.enableSingleRun) break;
      await sleep(config.loopDelayMs);
    }
  } finally {
    signal?.removeEventListener('abort', stop);
    await heartbeat('stopped', { phase: 'shutdown' });
    await pool.end();
  }
}

async function scoreCandidate(input: {
  candidate: AcquisitionCandidate;
  correlationId: string;
  portfolioBatchId: string;
}): Promise<ScoredAcquisitionDecision> {
  const { candidate, correlationId, portfolioBatchId } = input;

  const identity = resolveAcquisitionIdentity(candidate);
  const policy = await repository.getCategoryPolicy(config.policyVersion, identity.categoryKey);
  const comps = buildAcquisitionCompSet({
    identity,
    ebayMarketJson: candidate.ebayMarketJson,
  });
  const market = computeAcquisitionMarketProfile(comps);

  const preliminaryHash = hashAcquisitionInput({
    candidate,
    identity,
    comps,
    market,
    policyVersion: policy.policyVersion,
    scoringVersion: policy.scoringVersion,
  });

  const shippingSignal = await repository.getLatestShippingSignal(candidate.listingId);

  const financial = buildAcquisitionFinancialModel({
    candidate,
    policy,
    market,
    identity,
    cashOnHandUsd: config.cashOnHandUsd,
    shippingSignal,
  });

  const inputHash = hashAcquisitionInput({
    candidate,
    identity,
    comps,
    market,
    financial,
    policyVersion: policy.policyVersion,
    scoringVersion: policy.scoringVersion,
  }) || preliminaryHash;

  /*
   * Step 1: derive the economic decision WITHOUT using capital safety as a hard economic veto.
   * This preserves the BUY signal for analytics and downstream review/bid-monitor handling.
   */
  const economicSafety = makeSafetyEvaluation({
    originalDecision: 'BUY',
    hardBlockReasons: [],
    softReviewReasons: [],
    safetyScore: 1,
    replayCertificationStatus: 'PASSED',
    compGroundingStatus: 'PASSED',
    mutationLedgerStatus: 'READY',
    maxBidUsd: financial.maxBidUsd,
    isAuction: isAuctionCandidate(candidate),
    evidenceJson: { mode: 'economic_decision_only' },
  });

  const economicRules = hardenRuleEvaluation(
    evaluateAcquisitionRules({
      policy,
      identity,
      comps,
      market,
      financial,
      safety: economicSafety,
    }),
    economicSafety,
  );

  /*
   * Step 2: evaluate capital/execution safety against the original economic decision.
   * Hard blockers can stop execution; soft blockers must route BUY to review/bid-monitor,
   * not silently kill it.
   */
  const rawSafety = await evaluateCapitalSafety({
    pool,
    candidate,
    identity,
    comps,
    market,
    inputHash,
  });

  const safety = hardenSafetyEvaluation({
    rawSafety,
    originalDecision: economicRules.status,
    financialMaxBidUsd: financial.maxBidUsd,
    candidate,
  });

  const finalRules = preserveBuySignalWithExecution({
    originalRules: economicRules,
    safety,
  });

  return createScoredDecision({
    candidate,
    policy,
    identity,
    comps,
    market,
    financial,
    safety,
    originalRules: economicRules,
    finalRules,
    correlationId,
    portfolioBatchId,
    inputHash,
    allocationPosition: null,
  });
}

function hardenAllocatedDecision(decision: ScoredAcquisitionDecision): ScoredAcquisitionDecision {
  const wasSkippedForCapital =
    decision.allocationAudit?.wasSkippedForCapital === true ||
    decision.executionStatus === 'CAPITAL_LIMIT_SKIPPED' ||
    decision.purchaseQueueStatus === 'capital_limit_skipped';

  if (!wasSkippedForCapital) {
    return createScoredDecision({
      ...decision,
      finalRules: preserveBuySignalWithExecution({
        originalRules: decision.originalRules,
        safety: decision.safety,
      }),
    });
  }

  const finalRules = preserveBuySignalWithExecution({
    originalRules: decision.originalRules,
    safety: decision.safety,
    allocationSkipped: true,
    allocationSkipReason: decision.allocationAudit?.skipReason ?? 'CAPITAL_GATE_BUDGET_EXCEEDED',
  });

  return createScoredDecision({
    ...decision,
    finalRules,
  });
}

function hardenSafetyEvaluation(input: {
  rawSafety: RawSafetyEvaluation;
  originalDecision: AcquisitionDecisionStatus;
  financialMaxBidUsd: number | null;
  candidate: AcquisitionCandidate;
}): SafetyEvaluation {
  const rawHard = input.rawSafety.hardBlockReasons ?? input.rawSafety.blockingReasons ?? [];
  const rawSoft = input.rawSafety.softReviewReasons ?? input.rawSafety.reviewReasons ?? [];
  const merged = splitCapitalReasons(uniqueStrings([...rawHard, ...rawSoft]));

  const hardBlockReasons = uniqueStrings([
    ...merged.hardBlockReasons,
    ...deriveListingHardBlocks(input.candidate, input.financialMaxBidUsd),
  ]);

  const softReviewReasons = uniqueStrings([
    ...merged.softReviewReasons,
    ...merged.informationalReasons,
  ]);

  return makeSafetyEvaluation({
    originalDecision: input.originalDecision,
    hardBlockReasons,
    softReviewReasons,
    safetyScore: finiteNumber(input.rawSafety.safetyScore, hardBlockReasons.length > 0 ? 0.2 : softReviewReasons.length > 0 ? 0.65 : 0.9),
    replayCertificationStatus: input.rawSafety.replayCertificationStatus ?? 'NOT_AVAILABLE',
    compGroundingStatus: input.rawSafety.compGroundingStatus ?? 'NOT_AVAILABLE',
    mutationLedgerStatus: input.rawSafety.mutationLedgerStatus ?? 'NOT_AVAILABLE',
    maxBidUsd: input.financialMaxBidUsd,
    isAuction: isAuctionCandidate(input.candidate),
    evidenceJson: {
      ...(input.rawSafety.evidenceJson ?? {}),
      originalSafetyStatus: input.rawSafety.status ?? null,
      originalBlockingReasons: input.rawSafety.blockingReasons ?? [],
      originalReviewReasons: input.rawSafety.reviewReasons ?? [],
    },
  });
}

function hardenRuleEvaluation(rule: EconomicRuleEvaluation, safety: SafetyEvaluation): RuleEvaluation {
  const executionStatus = resolveExecutionStatus({
    originalDecision: rule.status,
    capitalStatus: safety.status,
    hardBlockReasons: safety.hardBlockReasons,
    softReviewReasons: safety.softReviewReasons,
  });
  const purchaseQueueStatus = resolvePurchaseQueueStatus(executionStatus);

  return {
    ...rule,
    capitalSafe: safety.status === 'PASS',
    capitalStatus: safety.status,
    allowedDecision: safety.allowedDecision,
    allowedExecutionStatus: executionStatus,
    purchaseQueueStatus,
    reasonCodes: uniqueStrings([...(rule.reasonCodes ?? []), ...safety.hardBlockReasons, ...safety.softReviewReasons]),
    riskFlags: uniqueStrings([...(rule.riskFlags ?? []), ...(safety.status === 'BLOCK' ? ['CAPITAL_HARD_BLOCK'] : []), ...(safety.status === 'REVIEW_REQUIRED' ? ['CAPITAL_REVIEW_REQUIRED'] : [])]),
  };
}

function deriveListingHardBlocks(
  candidate: AcquisitionCandidate,
  financialMaxBidUsd: number | null,
): string[] {
  const reasons: string[] = [];

  const listingStatus = candidate.listingStatus?.toLowerCase().trim();

  if (
    listingStatus &&
    ['ended', 'expired', 'sold', 'closed', 'cancelled', 'canceled', 'inactive'].includes(listingStatus)
  ) {
    reasons.push('CAPITAL_GATE_LISTING_NOT_LIVE');
  }

  if (candidate.endTime) {
    const endTime = new Date(candidate.endTime).getTime();
    if (Number.isFinite(endTime) && endTime < Date.now()) {
      reasons.push('CAPITAL_GATE_EXPIRED_AUCTION');
    }
  }

  const liveBid = Number(candidate.currentBidPrice ?? candidate.currentPrice ?? 0);
  const maxBid = Number(financialMaxBidUsd ?? 0);

  if (liveBid > 0 && maxBid > 0 && liveBid > maxBid) {
    reasons.push('CAPITAL_GATE_PRICE_EXCEEDS_MAX_BID');
  }

  return uniqueStrings(reasons);
}

function summarizeDecisions(decisions: readonly ScoredAcquisitionDecision[]): {
  originalBuyCount: number;
  autoBuyReadyCount: number;
  bidMonitorReadyCount: number;
  reviewRequiredCount: number;
  hardBlockedCount: number;
  expiredCount: number;
  capitalLimitSkippedCount: number;
  purchaseQueueEligibleCount: number;
} {
  return {
    originalBuyCount: decisions.filter((d) => d.originalRules.status === 'BUY').length,
    autoBuyReadyCount: decisions.filter((d) => d.executionStatus === 'AUTO_BUY_READY').length,
    bidMonitorReadyCount: decisions.filter((d) => d.executionStatus === 'BID_MONITOR_READY').length,
    reviewRequiredCount: decisions.filter((d) => d.executionStatus === 'REVIEW_REQUIRED').length,
    hardBlockedCount: decisions.filter((d) => d.executionStatus === 'BLOCKED').length,
    expiredCount: decisions.filter((d) => d.executionStatus === 'EXPIRED').length,
    capitalLimitSkippedCount: decisions.filter((d) => d.executionStatus === 'CAPITAL_LIMIT_SKIPPED').length,
    purchaseQueueEligibleCount: decisions.filter((d) => d.purchaseQueueEligible || isPurchaseQueueEligible(d.purchaseQueueStatus)).length,
  };
}

async function handleCandidateFailure(input: {
  candidate: AcquisitionCandidate;
  correlationId: string;
  portfolioBatchId: string;
  error: unknown;
}): Promise<void> {
  const { candidate, correlationId, portfolioBatchId, error } = input;
  const message = error instanceof Error ? error.message : String(error);

  await repository.markOpportunityRetry({
    opportunityQueueId: candidate.opportunityQueueId,
    errorMessage: message,
    workerId: config.workerInstanceId,
  });

  await repository.insertDeadLetter({
    queueName: 'acquisition_decision',
    entityType: 'opportunity_queue',
    entityPk: String(candidate.opportunityQueueId),
    workerName: config.workerName,
    workerInstanceId: config.workerInstanceId,
    errorCode: 'ACQ_SCORE_FAILED',
    errorMessage: message,
    payload: {
      candidate,
      correlationId,
      portfolioBatchId,
      error: serializeAcquisitionError(error),
    },
  });

  incAcqCounter('acq_decision_score_failures_total');

  logger.error('acquisition candidate failed', {
    operation: 'scoreCandidate',
    correlationId,
    portfolioBatchId,
    listingId: candidate.listingId,
    opportunityQueueId: candidate.opportunityQueueId,
    error: serializeAcquisitionError(error),
  });
}

async function heartbeat(status: string, details: Record<string, unknown>): Promise<void> {
  await repository.writeHeartbeat({
    workerName: config.workerName,
    workerInstanceId: config.workerInstanceId,
    status,
    details: {
      ...details,
      contractMode: 'hardened-buy-preserving-execution',
      queueEligibleStatuses: ['AUTO_BUY_READY', 'BID_MONITOR_READY', 'REVIEW_REQUIRED'],
      blockedStatuses: ['BLOCKED', 'EXPIRED', 'CAPITAL_LIMIT_SKIPPED'],
      at: new Date().toISOString(),
    },
  });
}

function isAuctionCandidate(candidate: AcquisitionCandidate): boolean {
  if (candidate.buyNowPrice != null && candidate.currentBidPrice == null) return false;
  if (candidate.currentBidPrice != null) return true;
  if (candidate.endTime != null) return true;

  const text = `${candidate.title ?? ''} ${candidate.opportunityReasonJson ? JSON.stringify(candidate.opportunityReasonJson) : ''}`.toLowerCase();
  return text.includes('auction') || text.includes('bid');
}

function finiteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function intEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function floatEnv(name: string, fallback: number): number {
  const n = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(n) ? n : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  const ac = new AbortController();

  process.on('SIGINT', () => ac.abort());
  process.on('SIGTERM', () => ac.abort());

  runAcquisitionDecisionWorker(ac.signal).catch((error) => {
    logger.error('acquisition decision worker crashed', {
      operation: 'processExit',
      error: serializeAcquisitionError(error),
    });
    process.exit(1);
  });
}
