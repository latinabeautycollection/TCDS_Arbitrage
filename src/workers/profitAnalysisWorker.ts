import { Pool } from 'pg';
import os from 'os';
import {
  AcceptedComp,
  DecisionCode,
  ProfitAnalysisRepository,
  ProfitAnalysisResult,
  ProfitReadyCandidate,
} from '../repositories/profitAnalysisRepository';

const PROCESS_NAME = 'profitAnalysisWorker';
const PROCESS_STAGE = 'PROFIT_ANALYSIS';
const CODE_VERSION = process.env.CODE_VERSION ?? 'profitAnalysisWorker.v1.0.0';
const RULESET_VERSION = process.env.PROFIT_RULESET_VERSION ?? 'profit-rules.v1.0.0';
const MODEL_VERSION = process.env.PROFIT_MODEL_VERSION ?? 'deterministic-profit-model.v1.0.0';

const BATCH_LIMIT = Number(process.env.PROFIT_ANALYSIS_BATCH_LIMIT ?? 50);
const POLL_INTERVAL_MS = Number(process.env.PROFIT_ANALYSIS_POLL_INTERVAL_MS ?? 30000);
const MIN_ACCEPTED_COMPS = Number(process.env.PROFIT_MIN_ACCEPTED_COMPS ?? 5);
const ENABLE_MEDIAN_GATE = (process.env.PROFIT_ENABLE_MEDIAN_GATE ?? 'false') === 'true';
const MEDIAN_DISCOUNT = Number(process.env.PROFIT_MEDIAN_DISCOUNT ?? 0.15);
const DEMAND_MIN = Number(process.env.PROFIT_DEMAND_MIN ?? 3);
const ACTIVATION_LOCK_RE = /activation[ _-]*lock|icloud[ _-]*lock/i;
function isActivationLocked(title: string | null | undefined): boolean {
  return ACTIVATION_LOCK_RE.test(title ?? '');
}
const BUY_MIN_NET_PROFIT = Number(process.env.PROFIT_BUY_MIN_NET_PROFIT ?? 20);
const BUY_MIN_MARGIN = Number(process.env.PROFIT_BUY_MIN_MARGIN ?? 0.22);
const BUY_MIN_ROI = Number(process.env.PROFIT_BUY_MIN_ROI ?? 0.35);
const BUY_MIN_CONFIDENCE = Number(process.env.PROFIT_BUY_MIN_CONFIDENCE ?? 0.7);
const REVIEW_MIN_NET_PROFIT = Number(process.env.PROFIT_REVIEW_MIN_NET_PROFIT ?? 10);
const DEFAULT_PAYMENT_RATE = Number(process.env.PROFIT_PAYMENT_FEE_RATE ?? 0.029);
const DEFAULT_PAYMENT_FIXED = Number(process.env.PROFIT_PAYMENT_FIXED_USD ?? 0.3);
const DEFAULT_PACKAGING_COST = Number(process.env.PROFIT_PACKAGING_COST_USD ?? 2.0);

const WORKER_INSTANCE_ID =
  process.env.WORKER_INSTANCE_ID ??
  `${PROCESS_NAME}-${os.hostname()}-${process.pid}`;

interface PriceStats {
  low: number;
  p25: number;
  median: number;
  p75: number;
  high: number;
  average: number;
  iqr: number;
  priceStabilityScore: number;
}

interface FeeModel {
  ebayFeeRate: number;
  returnsBufferRate: number;
  promoBufferRate: number;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundScore(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;

  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sorted.length) return sorted[sorted.length - 1]!;

  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function calculatePriceStats(comps: AcceptedComp[]): PriceStats {
  const prices = comps
    .map((comp) => comp.totalPriceUsd)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);

  const low = prices[0] ?? 0;
  const high = prices[prices.length - 1] ?? 0;
  const p25 = percentile(prices, 0.25);
  const median = percentile(prices, 0.5);
  const p75 = percentile(prices, 0.75);
  const average = prices.reduce((sum, value) => sum + value, 0) / Math.max(prices.length, 1);
  const iqr = Math.max(p75 - p25, 0);
  const priceStabilityScore =
    median > 0 ? Math.max(0, Math.min(1, 1 - iqr / median)) : 0;

  return {
    low: roundMoney(low),
    p25: roundMoney(p25),
    median: roundMoney(median),
    p75: roundMoney(p75),
    high: roundMoney(high),
    average: roundMoney(average),
    iqr: roundMoney(iqr),
    priceStabilityScore: roundScore(priceStabilityScore),
  };
}

function estimateOutboundShipping(candidate: ProfitReadyCandidate): number {
  const title = candidate.title.toLowerCase();
  const category = candidate.sourceCategoryKey?.toLowerCase() ?? '';

  if (
    title.includes('iphone') ||
    title.includes('airpods') ||
    title.includes('earbuds') ||
    title.includes('headphone') ||
    title.includes('ssd') ||
    title.includes('ipod') ||
    title.includes('remote') ||
    title.includes('case')
  ) {
    return 6.95;
  }

  if (
    title.includes('speaker') ||
    title.includes('boombox') ||
    title.includes('camera') ||
    title.includes('keyboard') ||
    title.includes('controller') ||
    category.includes('electronics')
  ) {
    return 12.95;
  }

  if (
    title.includes('tool') ||
    title.includes('lock') ||
    title.includes('fridge') ||
    title.includes('lamp') ||
    title.includes('solar') ||
    title.includes('inflator')
  ) {
    return 18.95;
  }

  return 9.95;
}

function calculateAverageCompScore(comps: AcceptedComp[]): number {
  const scores = comps
    .map((comp) => comp.overallCompScore)
    .filter((score): score is number => score !== null && Number.isFinite(score));

  if (scores.length === 0) return 0.5;

  return roundScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function calculateConfidence(input: {
  candidate: ProfitReadyCandidate;
  acceptedCompCount: number;
  averageCompScore: number;
  priceStabilityScore: number;
}): number {
  const compDepthScore = Math.min(input.acceptedCompCount / 20, 1);
  const identityScore = Math.max(0, Math.min(input.candidate.identityConfidence ?? 0.45, 1));
  const compScore = Math.max(0, Math.min(input.averageCompScore, 1));
  const stabilityScore = Math.max(0, Math.min(input.priceStabilityScore, 1));

  const confidence =
    compDepthScore * 0.3 +
    compScore * 0.3 +
    identityScore * 0.25 +
    stabilityScore * 0.15;

  return roundScore(confidence);
}

function buildRiskFlags(candidate: ProfitReadyCandidate, stats: PriceStats, confidence: number): string[] {
  const flags: string[] = [];

  if ((candidate.identityConfidence ?? 0) < 0.6) flags.push('WEAK_IDENTITY_CONFIDENCE');
  if (candidate.isAccessory) flags.push('ACCESSORY_ITEM');
  if (candidate.isBundle) flags.push('BUNDLE_ITEM');
  if (stats.median > 0 && stats.iqr / stats.median > 0.45) flags.push('HIGH_COMP_PRICE_SPREAD');
  if (confidence < BUY_MIN_CONFIDENCE) flags.push('LOW_PROFIT_CONFIDENCE');
  if (candidate.currentPrice <= 1) flags.push('LOW_STARTING_BID_MONITOR_AUCTION_RISK');

  return flags;
}

function chooseDecision(input: {
  acceptedCompCount: number;
  medianGateQualifies: boolean;
  estimatedNetProfitUsd: number;
  estimatedMarginPct: number;
  estimatedRoiPct: number;
  confidenceScore: number;
  riskFlags: string[];
}): DecisionCode {
  if (input.acceptedCompCount < MIN_ACCEPTED_COMPS && !input.medianGateQualifies) {
    return 'PASS_INSUFFICIENT_COMPS';
  }

  if (
    input.estimatedNetProfitUsd >= BUY_MIN_NET_PROFIT &&
    input.estimatedMarginPct >= BUY_MIN_MARGIN &&
    input.estimatedRoiPct >= BUY_MIN_ROI &&
    input.confidenceScore >= BUY_MIN_CONFIDENCE &&
    !input.riskFlags.includes('WEAK_IDENTITY_CONFIDENCE') &&
    !input.riskFlags.includes('HIGH_COMP_PRICE_SPREAD')
  ) {
    return 'BUY';
  }

  if (
    input.estimatedNetProfitUsd >= REVIEW_MIN_NET_PROFIT &&
    input.estimatedMarginPct > 0.1 &&
    input.confidenceScore >= 0.5
  ) {
    return 'REVIEW';
  }

  if (input.confidenceScore < 0.5) {
    return 'PASS_LOW_CONFIDENCE';
  }

  return 'PASS_LOW_MARGIN';
}

function buildReasonCodes(result: {
  decisionCode: DecisionCode;
  acceptedCompCount: number;
  estimatedNetProfitUsd: number;
  estimatedMarginPct: number;
  estimatedRoiPct: number;
  confidenceScore: number;
}): string[] {
  const reasons: string[] = [];

  reasons.push(`DECISION_${result.decisionCode}`);
  reasons.push(`ACCEPTED_COMPS_${result.acceptedCompCount}`);

  if (result.estimatedNetProfitUsd >= BUY_MIN_NET_PROFIT) reasons.push('NET_PROFIT_ABOVE_BUY_FLOOR');
  if (result.estimatedMarginPct >= BUY_MIN_MARGIN) reasons.push('MARGIN_ABOVE_BUY_FLOOR');
  if (result.estimatedRoiPct >= BUY_MIN_ROI) reasons.push('ROI_ABOVE_BUY_FLOOR');
  if (result.confidenceScore >= BUY_MIN_CONFIDENCE) reasons.push('CONFIDENCE_ABOVE_BUY_FLOOR');

  return reasons;
}

function mapDecisionToExistingEnum(decisionCode: DecisionCode, enumLabels: string[]): string {
  if (decisionCode === 'BUY' && enumLabels.includes('BUY')) return 'BUY';

  if (decisionCode === 'REVIEW') {
    if (enumLabels.includes('REVIEW')) return 'REVIEW';
    if (enumLabels.includes('WATCH')) return 'WATCH';
    return enumLabels.includes('REJECT') ? 'REJECT' : (enumLabels[0] ?? 'REJECT');
  }

  if (enumLabels.includes('REJECT')) return 'REJECT';
  if (enumLabels.includes('PASS')) return 'PASS';
  return enumLabels[0] ?? 'REJECT';
}

function buildProfitAnalysis(
  candidate: ProfitReadyCandidate,
  comps: AcceptedComp[],
  counts: {
    accepted: number;
    rejected: number;
    manualReview: number;
  },
  feeModel: FeeModel,
): ProfitAnalysisResult {
  const stats = calculatePriceStats(comps);
  const averageCompScore = calculateAverageCompScore(comps);

  const marketMedian = candidate.medianActivePrice ?? null;
  const demandSignal = candidate.activeCount ?? 0;
  const medianGateQualifies =
    ENABLE_MEDIAN_GATE &&
    !isActivationLocked(candidate.title) &&
    counts.accepted < MIN_ACCEPTED_COMPS &&
    marketMedian !== null &&
    marketMedian > 0 &&
    demandSignal >= DEMAND_MIN;

  const recommendedSalePriceUsd = medianGateQualifies
    ? roundMoney(marketMedian * (1 - MEDIAN_DISCOUNT))
    : roundMoney(stats.median);
  const propertyroomCostUsd = roundMoney(candidate.currentPrice);
  const inboundShippingUsd = roundMoney(candidate.inboundShippingUsd ?? 0);
  const outboundShippingEstimateUsd = roundMoney(estimateOutboundShipping(candidate));

  const ebayFeeEstimateUsd = roundMoney(recommendedSalePriceUsd * feeModel.ebayFeeRate);
  const paymentFeeUsd = roundMoney(recommendedSalePriceUsd * DEFAULT_PAYMENT_RATE + DEFAULT_PAYMENT_FIXED);
  const packagingCostUsd = roundMoney(DEFAULT_PACKAGING_COST);
  const returnReserveUsd = roundMoney(recommendedSalePriceUsd * feeModel.returnsBufferRate);
  const promoReserveUsd = roundMoney(recommendedSalePriceUsd * feeModel.promoBufferRate);

  const totalCostBasisUsd = roundMoney(
    propertyroomCostUsd +
      inboundShippingUsd +
      outboundShippingEstimateUsd +
      ebayFeeEstimateUsd +
      paymentFeeUsd +
      packagingCostUsd +
      returnReserveUsd +
      promoReserveUsd,
  );

  const estimatedNetProfitUsd = roundMoney(recommendedSalePriceUsd - totalCostBasisUsd);
  const estimatedMarginPct =
    recommendedSalePriceUsd > 0
      ? roundScore(estimatedNetProfitUsd / recommendedSalePriceUsd)
      : 0;

  const cashOutlay = Math.max(propertyroomCostUsd + inboundShippingUsd, 0.01);
  const estimatedRoiPct = roundScore(estimatedNetProfitUsd / cashOutlay);

  const confidenceScore = calculateConfidence({
    candidate,
    acceptedCompCount: counts.accepted,
    averageCompScore,
    priceStabilityScore: stats.priceStabilityScore,
  });

  const riskFlags = buildRiskFlags(candidate, stats, confidenceScore);

  const decisionCode = chooseDecision({
    acceptedCompCount: counts.accepted,
    medianGateQualifies,
    estimatedNetProfitUsd,
    estimatedMarginPct,
    estimatedRoiPct,
    confidenceScore,
    riskFlags,
  });

  const reasonCodes = buildReasonCodes({
    decisionCode,
    acceptedCompCount: counts.accepted,
    estimatedNetProfitUsd,
    estimatedMarginPct,
    estimatedRoiPct,
    confidenceScore,
  });

  const phaseSummaryCurrent =
    decisionCode === 'BUY'
      ? `PROFIT_ANALYSIS_BUY: estimated profit $${estimatedNetProfitUsd}, margin ${Math.round(estimatedMarginPct * 100)}%, confidence ${confidenceScore}`
      : decisionCode === 'REVIEW'
        ? `PROFIT_ANALYSIS_REVIEW: estimated profit $${estimatedNetProfitUsd}, margin ${Math.round(estimatedMarginPct * 100)}%, confidence ${confidenceScore}`
        : `PROFIT_ANALYSIS_PASS: ${decisionCode}, estimated profit $${estimatedNetProfitUsd}, margin ${Math.round(estimatedMarginPct * 100)}%, confidence ${confidenceScore}`;

  return {
    candidateId: candidate.candidateId,
    listingId: candidate.listingId,
    analysisVersion: 1,
    acceptedCompCount: counts.accepted,
    rejectedCompCount: counts.rejected,
    manualReviewCompCount: counts.manualReview,
    lowCompPriceUsd: stats.p25,
    medianCompPriceUsd: stats.median,
    highCompPriceUsd: stats.p75,
    recommendedSalePriceUsd,
    ebayFeeEstimateUsd,
    outboundShippingEstimateUsd,
    propertyroomCostUsd,
    inboundShippingUsd,
    paymentFeeUsd,
    packagingCostUsd,
    returnReserveUsd,
    promoReserveUsd,
    totalCostBasisUsd,
    estimatedNetProfitUsd,
    estimatedMarginPct,
    estimatedRoiPct,
    confidenceScore,
    decisionCode,
    reasonCodes,
    riskFlags,
    phaseSummaryCurrent,
    decisionReasonJson: {
      policy: {
        rulesetVersion: RULESET_VERSION,
        minAcceptedComps: MIN_ACCEPTED_COMPS,
        buyMinNetProfit: BUY_MIN_NET_PROFIT,
        buyMinMargin: BUY_MIN_MARGIN,
        buyMinRoi: BUY_MIN_ROI,
        buyMinConfidence: BUY_MIN_CONFIDENCE,
        reviewMinNetProfit: REVIEW_MIN_NET_PROFIT,
      },
      candidate: {
        candidateId: candidate.candidateId,
        listingId: candidate.listingId,
        title: candidate.title,
        currentPrice: propertyroomCostUsd,
        inboundShippingUsd,
        identityConfidence: candidate.identityConfidence,
        sourceCategoryKey: candidate.sourceCategoryKey,
        isAccessory: candidate.isAccessory,
        isBundle: candidate.isBundle,
      },
      comps: {
        acceptedCompCount: counts.accepted,
        rejectedCompCount: counts.rejected,
        manualReviewCompCount: counts.manualReview,
        lowCompPriceUsd: stats.low,
        p25CompPriceUsd: stats.p25,
        medianCompPriceUsd: stats.median,
        p75CompPriceUsd: stats.p75,
        highCompPriceUsd: stats.high,
        averageCompPriceUsd: stats.average,
        iqr: stats.iqr,
        priceStabilityScore: stats.priceStabilityScore,
        averageCompScore,
      },
      costModel: {
        recommendedSalePriceUsd,
        propertyroomCostUsd,
        inboundShippingUsd,
        outboundShippingEstimateUsd,
        ebayFeeEstimateUsd,
        paymentFeeUsd,
        packagingCostUsd,
        returnReserveUsd,
        promoReserveUsd,
        totalCostBasisUsd,
      },
      outcome: {
        estimatedNetProfitUsd,
        estimatedMarginPct,
        estimatedRoiPct,
        confidenceScore,
        decisionCode,
        reasonCodes,
        riskFlags,
      },
    },
  };
}

async function processCandidate(
  repository: ProfitAnalysisRepository,
  candidate: ProfitReadyCandidate,
): Promise<{
  processed: boolean;
  decisionCode?: DecisionCode;
  profit?: number;
}> {
  return repository.withTransaction(async (client) => {
    const locked = await repository.tryCandidateLock(client, candidate.candidateId);

    if (!locked) {
      return { processed: false };
    }

    const processRunId = await repository.startProcessRun(client, {
      processName: PROCESS_NAME,
      processStage: PROCESS_STAGE,
      workerName: PROCESS_NAME,
      workerInstanceId: WORKER_INSTANCE_ID,
      hostName: os.hostname(),
      codeVersion: CODE_VERSION,
      rulesetVersion: RULESET_VERSION,
      modelVersion: MODEL_VERSION,
    });

    let stepId: number | undefined;

    try {
      stepId = await repository.createProcessStep(client, {
        runId: processRunId,
        candidateId: candidate.candidateId,
        stepName: 'calculate_profitability',
        status: 'RUNNING',
        payload: {
          candidateId: candidate.candidateId,
          listingId: candidate.listingId,
          acceptedCompCount: candidate.acceptedCompCount,
        },
      });

      const comps = await repository.getAcceptedComps(client, candidate.candidateId);
      const counts = await repository.getCompCounts(client, candidate.candidateId);
      const feeModel = await repository.getFeeModel(client);

      if (counts.accepted < MIN_ACCEPTED_COMPS) {
        const marketMedianRecheck = candidate.medianActivePrice ?? null;
        const demandRecheck = candidate.activeCount ?? 0;
        const medianEligibleRecheck =
          ENABLE_MEDIAN_GATE && !isActivationLocked(candidate.title) && marketMedianRecheck !== null && marketMedianRecheck > 0 && demandRecheck >= DEMAND_MIN;
        if (!medianEligibleRecheck) {
          throw new Error(
            `Candidate ${candidate.candidateId} no longer has enough accepted comps. accepted=${counts.accepted}`,
          );
        }
      }

      const result = buildProfitAnalysis(candidate, comps, counts, feeModel);
      const enumLabels = await repository.getDecisionEnumLabels(client);
      const decisionEnumValue = mapDecisionToExistingEnum(result.decisionCode, enumLabels);

      const profitAnalysisId = await repository.upsertProfitAnalysis(
        client,
        result,
        PROCESS_NAME,
        processRunId,
        WORKER_INSTANCE_ID,
        PROCESS_NAME,
        CODE_VERSION,
        RULESET_VERSION,
        MODEL_VERSION,
      );

      const decisionId = await repository.upsertDecisionFromProfit(client, {
        result,
        decisionEnumValue,
        processName: PROCESS_NAME,
        processRunId,
        actorId: WORKER_INSTANCE_ID,
        actorName: PROCESS_NAME,
        codeVersion: CODE_VERSION,
        rulesetVersion: RULESET_VERSION,
        modelVersion: MODEL_VERSION,
      });

      await repository.updateCandidateAfterProfit(client, {
        candidateId: candidate.candidateId,
        processName: PROCESS_NAME,
        processRunId,
        actorId: WORKER_INSTANCE_ID,
        actorName: PROCESS_NAME,
        codeVersion: CODE_VERSION,
        rulesetVersion: RULESET_VERSION,
        modelVersion: MODEL_VERSION,
        phaseSummary: result.phaseSummaryCurrent,
        decisionCode: result.decisionCode,
      });

      const forensicEventId = await repository.writeForensicEvent(client, {
        processRunId,
        processStepId: stepId,
        candidateId: candidate.candidateId,
        eventType: 'PROFIT_ANALYSIS_COMPLETED',
        actionType: result.decisionCode,
        workerName: PROCESS_NAME,
        workerInstanceId: WORKER_INSTANCE_ID,
        sourceTable: 'arb.profit_analysis',
        sourcePk: String(profitAnalysisId),
        evidence: result.decisionReasonJson,
        metrics: {
          estimatedNetProfitUsd: result.estimatedNetProfitUsd,
          estimatedMarginPct: result.estimatedMarginPct,
          estimatedRoiPct: result.estimatedRoiPct,
          confidenceScore: result.confidenceScore,
          acceptedCompCount: result.acceptedCompCount,
        },
        flags: result.riskFlags,
      });

      await repository.writePricingEvidence(client, {
        processRunId,
        processStepId: stepId,
        forensicEventId,
        result,
        decisionId,
      });

      await repository.writeProductJournal(client, {
        result,
        processName: PROCESS_NAME,
        processRunId,
        workerName: PROCESS_NAME,
        workerInstanceId: WORKER_INSTANCE_ID,
        codeVersion: CODE_VERSION,
        rulesetVersion: RULESET_VERSION,
        modelVersion: MODEL_VERSION,
      });

      await repository.completeProcessStep(client, {
        stepId,
        status: 'SUCCEEDED',
        result: {
          profitAnalysisId,
          decisionId,
          decisionCode: result.decisionCode,
          estimatedNetProfitUsd: result.estimatedNetProfitUsd,
          estimatedMarginPct: result.estimatedMarginPct,
          estimatedRoiPct: result.estimatedRoiPct,
          confidenceScore: result.confidenceScore,
        },
      });

      await repository.completeProcessRun(client, {
        runId: processRunId,
        status: 'SUCCEEDED',
        rowsSeen: 1,
        rowsSucceeded: 1,
        rowsFailed: 0,
        details: {
          candidateId: candidate.candidateId,
          profitAnalysisId,
          decisionId,
          decisionCode: result.decisionCode,
          estimatedNetProfitUsd: result.estimatedNetProfitUsd,
        },
      });

      return {
        processed: true,
        decisionCode: result.decisionCode,
        profit: result.estimatedNetProfitUsd,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Surface the original error before catch-block SQL aborts on the dead transaction
      console.error(JSON.stringify({
        level: 'error',
        worker: PROCESS_NAME,
        candidateId: candidate.candidateId,
        msg: 'ORIGINAL_ERROR',
        original: message,
        stack: error instanceof Error ? error.stack : undefined,
      }));

      if (stepId) {
        await repository.completeProcessStep(client, {
          stepId,
          status: 'FAILED',
          errorCode: 'PROFIT_ANALYSIS_FAILED',
          errorMessage: message,
        });
      }

      await repository.writeDeadLetter(client, {
        processRunId,
        processStepId: stepId,
        candidateId: candidate.candidateId,
        workerName: PROCESS_NAME,
        workerInstanceId: WORKER_INSTANCE_ID,
        errorCode: 'PROFIT_ANALYSIS_FAILED',
        errorMessage: message,
        payload: {
          candidate,
        },
      });

      await repository.completeProcessRun(client, {
        runId: processRunId,
        status: 'FAILED',
        rowsSeen: 1,
        rowsSucceeded: 0,
        rowsFailed: 1,
        errorClass: 'PROFIT_ANALYSIS_FAILED',
        errorSummary: message,
        details: {
          candidateId: candidate.candidateId,
          error: message,
        },
      });

      throw error;
    }
  });
}

async function runOnce(repository: ProfitAnalysisRepository): Promise<void> {
  await repository.heartbeat({
    workerName: PROCESS_NAME,
    workerInstanceId: WORKER_INSTANCE_ID,
    status: 'running',
    details: {
      stage: 'polling',
      batchLimit: BATCH_LIMIT,
      minAcceptedComps: MIN_ACCEPTED_COMPS,
      codeVersion: CODE_VERSION,
      rulesetVersion: RULESET_VERSION,
      modelVersion: MODEL_VERSION,
    },
  });

const candidates = await repository.findProfitReadyCandidates(BATCH_LIMIT, RULESET_VERSION, MIN_ACCEPTED_COMPS, ENABLE_MEDIAN_GATE ? DEMAND_MIN : 2000000000);
  let processed = 0;
  let failed = 0;
  let skippedLocked = 0;
  let buy = 0;
  let review = 0;
  let pass = 0;

  for (const candidate of candidates) {
    try {
      const result = await processCandidate(repository, candidate);

      if (!result.processed) {
        skippedLocked += 1;
        continue;
      }

      processed += 1;

      if (result.decisionCode === 'BUY') buy += 1;
      else if (result.decisionCode === 'REVIEW') review += 1;
      else pass += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          level: 'error',
          worker: PROCESS_NAME,
          candidateId: candidate.candidateId,
          message,
        }),
      );
    }
  }

  await repository.heartbeat({
    workerName: PROCESS_NAME,
    workerInstanceId: WORKER_INSTANCE_ID,
    status: 'idle',
    details: {
      lastBatchCandidateCount: candidates.length,
      processed,
      failed,
      skippedLocked,
      buy,
      review,
      pass,
      completedAt: new Date().toISOString(),
    },
  });

  console.log(
    JSON.stringify({
      level: 'info',
      worker: PROCESS_NAME,
      batch: {
        candidates: candidates.length,
        processed,
        failed,
        skippedLocked,
        buy,
        review,
        pass,
      },
    }),
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.PROFIT_ANALYSIS_DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  const repository = new ProfitAnalysisRepository(pool);

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(
      JSON.stringify({
        level: 'info',
        worker: PROCESS_NAME,
        message: `Received ${signal}; shutting down`,
      }),
    );

    await repository.heartbeat({
      workerName: PROCESS_NAME,
      workerInstanceId: WORKER_INSTANCE_ID,
      status: 'stopping',
      details: {
        signal,
        stoppedAt: new Date().toISOString(),
      },
    });

    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  console.log(
    JSON.stringify({
      level: 'info',
      worker: PROCESS_NAME,
      workerInstanceId: WORKER_INSTANCE_ID,
      codeVersion: CODE_VERSION,
      rulesetVersion: RULESET_VERSION,
      modelVersion: MODEL_VERSION,
      message: 'profitAnalysisWorker started',
    }),
  );

  while (!shuttingDown) {
    try {
      await runOnce(repository);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(
        JSON.stringify({
          level: 'error',
          worker: PROCESS_NAME,
          message,
        }),
      );

      await repository.heartbeat({
        workerName: PROCESS_NAME,
        workerInstanceId: WORKER_INSTANCE_ID,
        status: 'error',
        details: {
          error: message,
          at: new Date().toISOString(),
        },
      });
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      level: 'fatal',
      worker: PROCESS_NAME,
      message,
    }),
  );
  process.exit(1);
});
