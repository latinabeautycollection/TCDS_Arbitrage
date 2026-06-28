
import crypto from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import {
  createEbayClient,
  EbayClientError,
  type EbayClient,
  type BrowseSearchResult,
  type DetailedEbayItem,
  type CatalogProductDetail,
  type TaxonomyAspectResponse,
  type AnalysisProng,
} from '../services/ebayClient';
import { comparePropertyRoomToEbay } from '../services/ebayIdentity';
import { createLogger, type Logger, serializeError } from '../services/logger';

type CompStatus = 'pending' | 'processing' | 'completed' | 'retry' | 'dead_letter';
type WorkerHeartbeatStatus = 'starting' | 'running' | 'processing' | 'degraded' | 'stopped';
type ListingId = string & { readonly __brand: 'ListingId' };
type DecisionCode = 'BUY' | 'WATCH' | 'REJECT';
type AcceptanceStatus = 'accepted' | 'manual_review' | 'rejected';

const ANALYSIS_PRONG: AnalysisProng = 'PRONG1';

interface CompWorkerConfig {
  workerName: string;
  workerInstanceId: string;
  applicationName: string;
  idleSleepMs: number;
  loopDelayMs: number;
  heartbeatIntervalMs: number;
  lockTtlSeconds: number;
  maxAttempts: number;
  searchLimit: number;
  shortlistSoldCount: number;
  shortlistActiveCount: number;
  minAcceptedCompCount: number;
  minBuyIdentityScore: number;
  minBuyOverallScore: number;
  minWatchOverallScore: number;
  minProfitUsd: number;
  minRoi: number;
  feeRate: number;
  paymentProcessingRate: number;
  reserveRate: number;
}

interface ListingJob {
  id: ListingId;
  listingExternalId: string | null;
  title: string;
  normalizedTitle: string | null;
  descriptionRaw: string | null;
  brand: string | null;
  model: string | null;
  variant: string | null;
  categoryId: string | null;
  conditionText: string | null;
  currentPrice: number | null;
  buyNowPrice: number | null;
  currentBidPrice: number | null;
  inboundShippingUsd: number | null;
  totalCost: number | null;
  priority: number | null;
  compAttempts: number;
  compStatus: CompStatus;
candidateId: number | null;
}

interface WorkerRunOptions {
  once?: boolean;
  signal?: AbortSignal;
  pool?: Pool;
  ebayClient?: EbayClient;
  logger?: Logger;
}

interface ListingContext {
  listingId: ListingId;
  listingExternalId: string | null;
  sourceListingNormalizedId: number | null;
  candidateId: number | null;
}

interface HydratedCompRecord {
  compType: 'SOLD' | 'ACTIVE';
  summaryItemId: string;
  summaryTitle: string;
  detail: DetailedEbayItem;
  product: CatalogProductDetail | null;
  taxonomy: TaxonomyAspectResponse | null;
  identity: ReturnType<typeof comparePropertyRoomToEbay>;
  acceptanceStatus: AcceptanceStatus;
  rejectionReasonCode: string | null;
}

interface MarketAssessment {
  acceptedSoldComps: HydratedCompRecord[];
  watchSoldComps: HydratedCompRecord[];
  rejectedSoldComps: HydratedCompRecord[];
  activeComps: HydratedCompRecord[];
  medianAcceptedSoldPrice: number | null;
  medianAcceptedTotalSoldPrice: number | null;
  medianActivePrice: number | null;
  maxActivePrice: number | null;
  estimatedDaysToSell: number | null;
  sellThroughRate: number | null;
}

const config: CompWorkerConfig = {
  workerName: getEnv('COMP_WORKER_NAME', 'comp-analysis-worker'),
  workerInstanceId: getEnv('COMP_WORKER_INSTANCE_ID', crypto.randomUUID()),
  applicationName: getEnv('APP_SERVICE_NAME', 'arb-system-api'),
  idleSleepMs: getIntEnv('COMP_WORKER_IDLE_SLEEP_MS', 15000),
  loopDelayMs: getIntEnv('COMP_WORKER_LOOP_DELAY_MS', 1000),
  heartbeatIntervalMs: getIntEnv('COMP_WORKER_HEARTBEAT_INTERVAL_MS', 30000),
  lockTtlSeconds: getIntEnv('COMP_WORKER_LOCK_TTL_SECONDS', 900),
  maxAttempts: getIntEnv('COMP_WORKER_MAX_ATTEMPTS', 5),
  searchLimit: getIntEnv('EBAY_COMP_MARKET_LIMIT', 50),
  shortlistSoldCount: getIntEnv('COMP_WORKER_SHORTLIST_SOLD_COUNT', 8),
  shortlistActiveCount: getIntEnv('COMP_WORKER_SHORTLIST_ACTIVE_COUNT', 5),
  minAcceptedCompCount: getIntEnv('COMP_WORKER_MIN_ACCEPTED_COMPS', 3),
  minBuyIdentityScore: getFloatEnv('COMP_WORKER_MIN_BUY_IDENTITY_SCORE', 0.8),
  minBuyOverallScore: getFloatEnv('COMP_WORKER_MIN_BUY_OVERALL_SCORE', 0.8),
  minWatchOverallScore: getFloatEnv('COMP_WORKER_MIN_WATCH_OVERALL_SCORE', 0.65),
  minProfitUsd: getFloatEnv('ARB_MIN_ABSOLUTE_PROFIT_USD', 35),
  minRoi: getFloatEnv('ARB_MIN_ROI', 0.25),
  feeRate: getFloatEnv('ARB_FEE_RATE', 0.135),
  paymentProcessingRate: getFloatEnv('ARB_PAYMENT_PROCESSING_RATE', 0.03),
  reserveRate: getFloatEnv('ARB_RESERVE_RATE', 0.03),
};

// Patch I: Map PropertyRoom condition_text to eBay Browse API conditionIds filter
// eBay condition IDs:
//   1000 NEW, 1500 NEW_OTHER, 1750 NEW_WITH_DEFECTS,
//   2000-2500 REFURBISHED family,
//   3000 USED, 4000 VERY_GOOD, 5000 GOOD, 6000 ACCEPTABLE, 7000 FOR_PARTS
function buildConditionFilter(conditionText: string | null | undefined): string | null {
  if (!conditionText) return null;
  const t = conditionText.toLowerCase();

  if (/\b(new in sealed|sealed|factory sealed)\b/.test(t)) {
    return 'conditionIds:{1000|1500}'; // strict: sealed only
  }
  if (/\b(new in open box|open box|new other)\b/.test(t)) {
    return 'conditionIds:{1000|1500|1750}';
  }
  if (/\bnew in box\b/.test(t)) {
    return 'conditionIds:{1000|1500|1750}';
  }
  if (/\bnew\b/.test(t)) {
    return 'conditionIds:{1000|1500|1750}';
  }
  if (/\b(refurbished|renewed)\b/.test(t)) {
    return 'conditionIds:{2000|2010|2020|2030|2500}';
  }
  if (/\b(for parts|not working|broken|damaged)\b/.test(t)) {
    return 'conditionIds:{7000}';
  }
  if (/\bvery good\b/.test(t)) {
    return 'conditionIds:{3000|4000|5000}';
  }
  if (/\bgood\b/.test(t)) {
    return 'conditionIds:{3000|4000|5000|6000}';
  }
  if (/\b(fair|acceptable)\b/.test(t)) {
    return 'conditionIds:{3000|4000|5000|6000}';
  }
  if (/\b(used|pre-?owned)\b/.test(t)) {
    return 'conditionIds:{3000|4000|5000|6000}';
  }

  return null; // unknown → no filter (current behaviour)
}

export async function runCompAnalysisWorker(options: WorkerRunOptions = {}): Promise<void> {
  const logger = options.logger ?? createLogger({
    serviceName: config.applicationName,
    staticBindings: {
      component: 'compAnalysisWorker',
      workerName: config.workerName,
      workerInstanceId: config.workerInstanceId,
      analysisProng: ANALYSIS_PRONG,
    },
  });

  const pool = options.pool ?? createPool();
  const ebayClient = options.ebayClient ?? createEbayClient({ logger });
  const workerLogger = logger.child({
    component: 'compAnalysisWorker',
    workerName: config.workerName,
    workerInstanceId: config.workerInstanceId,
    analysisProng: ANALYSIS_PRONG,
  });

  let keepRunning = true;
  let lastHeartbeatAt = 0;

  const requestStop = (): void => {
    keepRunning = false;
    workerLogger.warn('stop requested', { operation: 'workerLoop' });
  };

  options.signal?.addEventListener('abort', requestStop);
  await writeHeartbeat(pool, workerLogger, { status: 'starting', details: { phase: 'boot' } });

  try {
    while (keepRunning) {
      try {
        if (Date.now() - lastHeartbeatAt >= config.heartbeatIntervalMs) {
          await writeHeartbeat(pool, workerLogger, { status: 'running', details: { phase: 'claiming_or_idle' } });
          lastHeartbeatAt = Date.now();
        }

        const listing = await claimNextListing(pool, workerLogger);
        if (!listing) {
          if (options.once) break;
          await sleep(config.idleSleepMs);
          continue;
        }

        await processClaimedListing({ pool, ebayClient, logger: workerLogger, listing });

        if (options.once) break;
        await sleep(config.loopDelayMs);
      } catch (error) {
        workerLogger.error('worker loop failure', {
          operation: 'workerLoop',
          error: serializeError(error),
        });

        await writeHeartbeat(pool, workerLogger, {
          status: 'degraded',
          details: { phase: 'loop_error', error: serializeError(error) },
        });

        if (options.once) throw error;
        await sleep(Math.max(config.loopDelayMs, 5000));
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', requestStop);
    await writeHeartbeat(pool, workerLogger, { status: 'stopped', details: { phase: 'shutdown' } });
    if (!options.pool) await pool.end();
  }
}

async function processClaimedListing(input: {
  pool: Pool;
  ebayClient: EbayClient;
  logger: Logger;
  listing: ListingJob;
}): Promise<void> {
  const { pool, ebayClient, logger, listing } = input;
  const correlationId = crypto.randomUUID();
  const startedAt = Date.now();
  const listingLogger = logger.child({
    listingId: listing.id,
    listingExternalId: listing.listingExternalId ?? undefined,
    correlationId,
  });

  try {
    const context = await resolveListingContext(pool, listing);
    const query = buildCompQuery(listing);
    if (!query) {
      throw new Error('Unable to derive valid eBay comp query from listing');
    }

        // Patch I: condition-aware search — map PR condition_text to eBay conditionIds
    const conditionFilter = buildConditionFilter(listing.conditionText);
    const baseSearchParams = {
      query,
      limit: config.searchLimit,
      categoryIds: listing.categoryId ? [listing.categoryId] : undefined,
      correlationId,
      analysisProng: ANALYSIS_PRONG,
      additionalFilters: conditionFilter ? [conditionFilter] : undefined,
    };

    const [soldSearch, activeSearch] = await Promise.all([
      ebayClient.searchSoldItems(baseSearchParams),
      ebayClient.searchActiveItems(baseSearchParams),
    ]);

    const searchJobId = await createSearchJob(pool, context, query, correlationId, listing);

    const soldSearchId = await persistMarketSearch(
      pool, searchJobId, context, correlationId, listing, query, soldSearch, 'SOLD',
    );
    const activeSearchId = await persistMarketSearch(
      pool, searchJobId, context, correlationId, listing, query, activeSearch, 'ACTIVE',
    );

    const shortlistedSold = shortlist(soldSearch, config.shortlistSoldCount);
    const shortlistedActive = shortlist(activeSearch, config.shortlistActiveCount);

    const soldRecords = await hydrateAndScoreShortlist(
      ebayClient,
      pool,
      listing,
      context,
      correlationId,
      searchJobId,
      soldSearchId,
      shortlistedSold,
      'SOLD',
    );
    const activeRecords = await hydrateAndScoreShortlist(
      ebayClient,
      pool,
      listing,
      context,
      correlationId,
      searchJobId,
      activeSearchId,
      shortlistedActive,
      'ACTIVE',
    );

    const assessment = buildMarketAssessment(soldRecords, activeRecords);
    const decision = computeDecision(listing, assessment);

    await persistCompSet(pool, context, correlationId, assessment, decision);
    await persistMarketAndDecision(pool, context, correlationId, listing, query, assessment, decision, searchJobId);
    const listingProduct = soldRecords.find(r => r.product)?.product ?? activeRecords.find(r => r.product)?.product ?? null;
    await finalizeSuccess(pool, listing.id, {
      correlationId,
      query,
      searchJobId,
      decision: decision.decision,
      acceptedSoldCompCount: assessment.acceptedSoldComps.length,
      activeCompCount: assessment.activeComps.length,
      manualReviewCompCount: assessment.watchSoldComps.length,
      rejectedSoldCompCount: assessment.rejectedSoldComps.length,
      medianAcceptedSoldPrice: assessment.medianAcceptedSoldPrice,
      medianAcceptedTotalSoldPrice: assessment.medianAcceptedTotalSoldPrice,
      medianActivePrice: assessment.medianActivePrice,
      sellThroughRate: assessment.sellThroughRate,
      estimatedDaysToSell: assessment.estimatedDaysToSell,
      avgIdentityMatchScore: averageIdentityScore(assessment.acceptedSoldComps),
      avgOverallCompScore: avgOverallScore(assessment.acceptedSoldComps),
      identityGatePassed: decision.decision !== 'REJECT',
      identityGateReason: decision.reasonJson,
      expectedResaleUsd: decision.expectedResaleUsd,
      estimatedProfitUsd: decision.estimatedProfitUsd,
      estimatedRoi: decision.estimatedRoi,
      durationMs: Date.now() - startedAt,
      analysisProng: ANALYSIS_PRONG,
      pricingMethod: decision.pricingMethod,
      product: listingProduct
        ? {
            epid: listingProduct.epid ?? null,
            title: listingProduct.title ?? null,
            brand: listingProduct.brand ?? null,
            gtins: listingProduct.gtins ?? null,
            mpns: listingProduct.mpns ?? null,
          }
        : null,
    });

        if (listing.candidateId) {
          await pool.query(
            `
            update arb.candidates
            set
              lifecycle_status = case
                when lifecycle_status = 'RECOVERED_NEEDS_EBAY_SEARCH'
                  then 'RECOVERED_EBAY_SEARCH_COMPLETED'
                else lifecycle_status
              end,
              updated_at = now()
            where id = $1
            `,
            [listing.candidateId],
          );
        }

    listingLogger.info('listing completed successfully', {
      operation: 'processClaimedListing',
      acceptedSoldCompCount: assessment.acceptedSoldComps.length,
      activeCompCount: assessment.activeComps.length,
      decision: decision.decision,
      estimatedProfitUsd: decision.estimatedProfitUsd,
      estimatedRoi: decision.estimatedRoi,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const retryable = isRetryableWorkerError(error);
    const failureClass = classifyWorkerError(error);
    const failureReason = extractErrorMessage(error);
    if (retryable && listing.compAttempts < config.maxAttempts) {
      await markListingForRetry(pool, listing.id, {
        nextAttemptAt: new Date(Date.now() + computeRetryDelayMs(listing.compAttempts)),
        failureReason,
        failureClass,
      });
      listingLogger.warn('listing scheduled for retry', {
        operation: 'processClaimedListing',
        failureClass,
        error: serializeError(error),
      });
      return;
    }

    await markListingTerminal(pool, listing.id, {
      terminalState: 'dead_letter',
      failureReason,
      failureClass,
      meta: { correlationId, error: serializeError(error) },
    });

    listingLogger.error('listing moved to dead letter', {
      operation: 'processClaimedListing',
      failureClass,
      error: serializeError(error),
    });
  }
}

function shortlist(search: BrowseSearchResult, count: number) {
  return search.itemSummaries.slice(0, count);
}

async function hydrateAndScoreShortlist(
  ebayClient: EbayClient,
  pool: Pool,
  listing: ListingJob,
  context: ListingContext,
  correlationId: string,
  searchJobId: number,
  marketSearchId: number,
  items: BrowseSearchResult['itemSummaries'],
  compType: 'SOLD' | 'ACTIVE',
): Promise<HydratedCompRecord[]> {
  const output: HydratedCompRecord[] = [];

  for (const item of items) {
    let detail;
    try {
      detail = item.legacyItemId
        ? await ebayClient.getItemByLegacyId(item.legacyItemId, { correlationId, includeProduct: true })
        : await ebayClient.getItem(item.itemId, { correlationId, includeProduct: true });
 } catch (err) {
  if (err instanceof EbayClientError && err.classification === 'ITEM_GROUP') {
    // Extract item_group_id from the error message (format: "...groupId=<id>...")
    const groupIdMatch = err.message.match(/groupId=(\d+)/);
    const itemGroupId = groupIdMatch?.[1];

    if (!itemGroupId) {
      console.log('[comp-worker] item_group with no groupId, skipping', {
  correlationId,
  legacyItemId: item.legacyItemId,
  itemId: item.itemId,
  rawErrorMessage: err.message,
  bodySnippet: (err as EbayClientError).bodySnippet,
  status: (err as EbayClientError).status,
});
      continue;
    }

    try {
      const variants = await ebayClient.getItemsByItemGroup(itemGroupId, {
        correlationId,
        includeProduct: true,
      });

      if (variants.length === 0) {
        console.log('[comp-worker] item_group returned no variants', {
          correlationId,
          itemGroupId,
        });
        continue;
      }

      // Pick best variant by title similarity to the PropertyRoom listing
      const prTitle = (listing.normalizedTitle ?? listing.title ?? '').toLowerCase();
      const scored = variants.map((v) => {
        const vTitle = (v.title ?? '').toLowerCase();
        // simple Jaccard-style overlap on word tokens
        const a = new Set(prTitle.split(/\s+/).filter(Boolean));
        const b = new Set(vTitle.split(/\s+/).filter(Boolean));
        const inter = [...a].filter((w) => b.has(w)).length;
        const union = new Set([...a, ...b]).size || 1;
        return { variant: v, score: inter / union };
      });
         scored.sort((x, y) => y.score - x.score);

      const best = scored[0];
      if (!best) {
        console.log('[comp-worker] item_group scoring produced no candidates', {
          correlationId,
          itemGroupId,
        });
        continue;
      }

      detail = best.variant;

      console.log('[comp-worker] item_group fallback picked variant', {
        correlationId,
        itemGroupId,
        variantCount: variants.length,
        bestScore: best.score,
        bestItemId: detail.itemId,
      });
      // fall through to the rest of the comp pipeline below with `detail` set
    } catch (fallbackErr) {
      console.log('[comp-worker] item_group fallback failed, skipping', {
        correlationId,
        itemGroupId,
        error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
      });
      continue;
    }
  } else {
    throw err;
  }
}

    const product = await resolveCatalogProduct(ebayClient, detail, correlationId);
    const leafCategoryId = detail.categoryId ?? product?.primaryCategoryId ?? null;
    let taxonomy: TaxonomyAspectResponse | null = null;
if (leafCategoryId) {
  try {
    taxonomy = await ebayClient.getItemAspectsForCategory(leafCategoryId, { correlationId });
  } catch (taxonomyErr) {
    // Some specialty categories return 400 from the aspects endpoint.
    // Aspects are an enrichment, not a blocker — proceed with null and continue scoring.
    console.log('[comp-worker] taxonomy lookup failed, continuing without aspects', {
      correlationId,
      leafCategoryId,
      error: taxonomyErr instanceof Error ? taxonomyErr.message : String(taxonomyErr),
    });
  }
}

    const identity = comparePropertyRoomToEbay(
      {
        listingId: listing.id,
        title: listing.title,
        normalizedTitle: listing.normalizedTitle,
        brand: listing.brand,
        model: listing.model,
        categoryId: listing.categoryId,
        conditionText: listing.conditionText,
        descriptionText: listing.descriptionRaw,
      },
      { ...detail, product: product ?? undefined },
      taxonomy,
    );

const epidAutoAccept = product?.epid != null && identity.gatePassed;

const acceptanceStatus: AcceptanceStatus =
  epidAutoAccept
    ? 'accepted'
    : identity.gatePassed && identity.overallScore >= config.minBuyOverallScore
      ? 'accepted'
      : identity.gatePassed && identity.overallScore >= config.minWatchOverallScore
        ? 'manual_review'
        : 'rejected';

    const rejectionReasonCode =
      acceptanceStatus === 'rejected'
        ? identity.gateReasons[0] ?? 'MATCH_SCORE_BELOW_THRESHOLD'
        : null;

    await persistCompArtifacts(
      pool,
      context,
      correlationId,
      searchJobId,
      marketSearchId,
      compType,
      detail,
      product,
      taxonomy,
      identity,
      acceptanceStatus,
      rejectionReasonCode,
    );

    output.push({
      compType,
      summaryItemId: item.itemId,
      summaryTitle: item.title,
      detail,
      product,
      taxonomy,
      identity,
      acceptanceStatus,
      rejectionReasonCode,
    });
  }

  return output;
}

async function resolveCatalogProduct(
  ebayClient: EbayClient,
  detail: DetailedEbayItem,
  correlationId: string,
): Promise<CatalogProductDetail | null> {
  if (process.env.EBAY_DISABLE_CATALOG === 'true') return null;
  if (detail.product) return detail.product;
  if (detail.epid) {
    try {
      return await ebayClient.getCatalogProduct(detail.epid, { correlationId });
    } catch {
      return null;
    }
  }
  return null;
}
function buildMarketAssessment(
  soldRecords: HydratedCompRecord[],
  activeRecords: HydratedCompRecord[],
): MarketAssessment {
  const acceptedSoldComps = soldRecords.filter((item) => item.acceptanceStatus === 'accepted');
  const watchSoldComps = soldRecords.filter((item) => item.acceptanceStatus === 'manual_review');
  const rejectedSoldComps = soldRecords.filter((item) => item.acceptanceStatus === 'rejected');

  const acceptedSoldPrices = acceptedSoldComps
    .map((item) => item.detail.priceValue)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  const acceptedSoldTotalPrices = acceptedSoldComps
    .map((item) => item.detail.totalPriceValue)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  const activePrices = activeRecords
    .map((item) => item.detail.priceValue)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  const sellThroughRate =
    acceptedSoldComps.length + activeRecords.length > 0
      ? roundNumber(acceptedSoldComps.length / (acceptedSoldComps.length + activeRecords.length), 4)
      : null;

  const estimatedDaysToSell =
    sellThroughRate === null ? null :
    sellThroughRate >= 0.6 ? 7 :
    sellThroughRate >= 0.35 ? 21 : 45;

  return {
    acceptedSoldComps,
    watchSoldComps,
    rejectedSoldComps,
    activeComps: activeRecords,
    medianAcceptedSoldPrice: quantile(trimOutliers(acceptedSoldPrices), 0.5),
    medianAcceptedTotalSoldPrice: quantile(trimOutliers(acceptedSoldTotalPrices), 0.5),
    medianActivePrice: quantile(trimOutliers(activePrices), 0.5),
    maxActivePrice: activePrices.length > 0 ? activePrices[activePrices.length - 1] ?? null : null,
    estimatedDaysToSell,
    sellThroughRate,
  };
}

function computeDecision(
  listing: ListingJob,
  assessment: MarketAssessment,
): {
  decision: DecisionCode;
  pricingMethod: 'sold_median' | 'active_max' | 'active_median' | 'none';
  expectedResaleUsd: number | null;
  expectedNetUsd: number | null;
  estimatedProfitUsd: number | null;
  estimatedRoi: number | null;
  maxBidUsd: number | null;
  reasonJson: Record<string, unknown>;
} {
  const sourceCost =
    listing.totalCost ??
    listing.buyNowPrice ??
    listing.currentBidPrice ??
    listing.currentPrice ??
    0;
  const inboundShipping = listing.inboundShippingUsd ?? 0;
  const totalAcquisitionCost = sourceCost + inboundShipping;
  const PROXY_BUY_DELTA = 5; // Anthony's $5 floor/ceiling on listed price
  const soldMedian = assessment.medianAcceptedTotalSoldPrice ?? assessment.medianAcceptedSoldPrice;
  const activeCount = assessment.activeComps.length;
  const activeMedian = assessment.medianActivePrice;
  const activeMax = assessment.maxActivePrice;

  let expectedResaleUsd: number | null = null;
  let pricingMethod: 'sold_median' | 'active_max' | 'active_median' | 'none' = 'none';

  if (soldMedian && assessment.acceptedSoldComps.length > 0) {
    // Tier 1: have sold comps → median sold + $5
    expectedResaleUsd = soldMedian + PROXY_BUY_DELTA;
    pricingMethod = 'sold_median';
  } else if (activeCount > 0 && activeCount < 5 && activeMax && activeMax > PROXY_BUY_DELTA) {
    // Tier 2: <5 active, no sold → max active − $5
    expectedResaleUsd = activeMax - PROXY_BUY_DELTA;
    pricingMethod = 'active_max';
  } else if (activeCount >= 5 && activeMedian) {
    // Tier 3: ≥5 active, no sold → median active + $5
    expectedResaleUsd = activeMedian + PROXY_BUY_DELTA;
    pricingMethod = 'active_median';
  }

  if (!expectedResaleUsd || expectedResaleUsd <= 0) {
    return {
      decision: 'REJECT',
      pricingMethod,   
      expectedResaleUsd: null,
      expectedNetUsd: null,
      estimatedProfitUsd: null,
      estimatedRoi: null,
      maxBidUsd: null,
      reasonJson: {
        reason: 'NO_PRICING_SIGNAL',
        acceptedSoldCompCount: assessment.acceptedSoldComps.length,
        activeCompCount: activeCount,
        pricingMethod,
      },
    };
  }
  const feeStack = config.feeRate + config.paymentProcessingRate + config.reserveRate;
  const expectedNetUsd = expectedResaleUsd * (1 - feeStack);
  const estimatedProfitUsd = expectedNetUsd - totalAcquisitionCost;
  const estimatedRoi = totalAcquisitionCost > 0 ? estimatedProfitUsd / totalAcquisitionCost : null;
  const maxBidUsd = Math.max(0, expectedNetUsd - inboundShipping - config.minProfitUsd);

  const hasSpecificity = !!(listing.model ?? '').trim() || !!(listing.brand ?? '').trim();
      const profitableOnAnyPath =
    (estimatedRoi ?? 0) >= config.minRoi &&
    estimatedProfitUsd >= config.minProfitUsd;

  const decision: DecisionCode = !hasSpecificity
    ? 'REJECT'
    : assessment.acceptedSoldComps.length >= config.minAcceptedCompCount &&
      (avgOverallScore(assessment.acceptedSoldComps) ?? 0) >= config.minBuyOverallScore &&
      profitableOnAnyPath &&
      pricingMethod === 'sold_median'
        ? 'BUY'
        : (
            estimatedProfitUsd >= 0 &&
            (
              (assessment.acceptedSoldComps.length >= 1 &&
               (avgOverallScore(assessment.acceptedSoldComps) ?? 0) >= config.minWatchOverallScore) ||
              (pricingMethod !== 'sold_median' && profitableOnAnyPath)
            )
          )
            ? 'WATCH'
            : 'REJECT';
  return {
    decision,
    pricingMethod,   
    expectedResaleUsd: roundNullable(expectedResaleUsd),
    expectedNetUsd: roundNullable(expectedNetUsd),
    estimatedProfitUsd: roundNullable(estimatedProfitUsd),
    estimatedRoi: roundNullable(estimatedRoi, 4),
    maxBidUsd: roundNullable(maxBidUsd),
    reasonJson: {
      pricingMethod,
      insufficientListingSpecificity: !hasSpecificity,
      acceptedSoldCompCount: assessment.acceptedSoldComps.length,
      watchSoldCompCount: assessment.watchSoldComps.length,
      rejectedSoldCompCount: assessment.rejectedSoldComps.length,
      avgAcceptedOverallScore: avgOverallScore(assessment.acceptedSoldComps),
      sellThroughRate: assessment.sellThroughRate,
      estimatedDaysToSell: assessment.estimatedDaysToSell,
    },
  };
}

function avgOverallScore(records: HydratedCompRecord[]): number | null {
  if (records.length === 0) return null;
  return roundNumber(
    records.reduce((sum, record) => sum + record.identity.overallScore, 0) / records.length,
    4,
  );
}

async function persistCompArtifacts(
  pool: Pool,
  context: ListingContext,
  correlationId: string,
  searchJobId: number,
  marketSearchId: number,
  compType: 'SOLD' | 'ACTIVE',
  detail: DetailedEbayItem,
  product: CatalogProductDetail | null,
  taxonomy: TaxonomyAspectResponse | null,
  identity: ReturnType<typeof comparePropertyRoomToEbay>,
  acceptanceStatus: AcceptanceStatus,
  rejectionReasonCode: string | null,
): Promise<void> {

  await pool.query(
    `
    insert into arb.ebay_market_item_raw (
      market_search_id, run_id, ebay_item_id, item_web_url, title, subtitle, category_id,
      category_path, condition_id, condition_text, listing_format, item_location_country,
      seller_username, seller_feedback_score, price_amount, price_currency, shipping_amount,
      shipping_currency, total_price_amount, end_time, sold_date, item_specifics, image_urls,
      raw_payload, created_at, analysis_prong, listing_id, candidate_id, source_listing_normalized_id,
      legacy_item_id, epid, gtins_json, brand, model, mpn, localized_aspects_json, product_ref_json
    )
    values (
      $1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,
      $24::jsonb,now(),$25,$26::uuid,$27,$28,$29,$30,$31::jsonb,$32,$33,$34,$35::jsonb,$36::jsonb
    )
    on conflict do nothing
    `,
    [
      marketSearchId,
      correlationId,
      detail.itemId,
      detail.itemWebUrl,
      detail.title,
      detail.subtitle ?? null,
      detail.categoryId,
      detail.categoryPath,
      detail.conditionId,
      detail.condition,
      detail.buyingOptions.join(','),
      detail.itemLocationCountry,
      detail.sellerUsername,
      detail.sellerFeedbackScore ?? null,
      detail.priceValue,
      detail.priceCurrency,
      detail.shippingValue,
      detail.shippingCurrency,
      detail.totalPriceValue,
      detail.itemEndDate,
      compType === 'SOLD' ? detail.itemEndDate ?? null : null,
      JSON.stringify(detail.localizedAspects),
      JSON.stringify([detail.imageUrl, ...(detail.additionalImages ?? [])].filter(Boolean)),
      JSON.stringify(detail.raw),
      ANALYSIS_PRONG,
      context.listingId,
      context.candidateId,
      context.sourceListingNormalizedId,
      detail.legacyItemId ?? null,
      detail.epid ?? product?.epid ?? null,
      JSON.stringify(identity.gtins),
      identity.normalizedBrand,
      identity.normalizedModel,
      identity.normalizedMpn,
      JSON.stringify(detail.localizedAspects),
      JSON.stringify({
        epid: product?.epid ?? detail.epid ?? null,
        title: product?.title ?? null,
        brand: product?.brand ?? null,
      }),
    ],
  );

  await pool.query(
    `
    insert into arb.ebay_comp_candidate (
      source_listing_normalized_id, run_id, ebay_item_id, comp_type, title, normalized_title,
      similarity_score, category_match, condition_match, price_amount, shipping_amount,
      total_price_amount, sold_date, end_time, listing_format, seller_username, item_specifics,
      include_flag, exclude_reason, created_at, analysis_prong, listing_id, candidate_id, search_job_id,
      brand, model, mpn, gtins_json, epid, leaf_category_id, leaf_category_path, category_tree_id,
      localized_aspects_json, product_ref_json, taxonomy_aspects_json, detail_fetched_at, detail_fetch_status,
      identity_confidence, identity_source, match_score, match_reason_json
    )
    values (
      $1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,now(),$20,$21::uuid,$22,$23,
      $24,$25,$26,$27::jsonb,$28,$29,$30,$31,$32::jsonb,$33::jsonb,$34::jsonb,now(),'hydrated',$35,'browse+detail+catalog',$36,$37::jsonb
    )
    on conflict do nothing
    `,
    [
      context.sourceListingNormalizedId,
      correlationId,
      detail.itemId,
      compType,
      detail.title,
      normalizeNullableText(detail.title),
      identity.titleScore,
      identity.categoryScore >= 0.5,
      identity.conditionScore >= 0.5,
      detail.priceValue,
      detail.shippingValue,
      detail.totalPriceValue,
      compType === 'SOLD' ? detail.itemEndDate ?? null : null,
      detail.itemEndDate,
      detail.buyingOptions.join(','),
      detail.sellerUsername,
      JSON.stringify(detail.localizedAspects),
      acceptanceStatus !== 'rejected',
      rejectionReasonCode,
      ANALYSIS_PRONG,
      context.listingId,
      context.candidateId,
      searchJobId,
      identity.normalizedBrand,
      identity.normalizedModel,
      identity.normalizedMpn,
      JSON.stringify(identity.gtins),
      identity.epid,
      identity.preferredCategoryId,
      identity.preferredCategoryPath,
      taxonomy?.categoryTreeId ?? null,
      JSON.stringify(detail.localizedAspects),
      JSON.stringify(product ?? {}),
      JSON.stringify(taxonomy ?? {}),
      identity.identityScore,
      identity.overallScore,
      JSON.stringify(identity.gateReasons),
    ],
  );

  if (!context.candidateId) return;

    await pool.query(
    `
    insert into arb.ebay_comps (
      candidate_id, job_id, ebay_item_id, epid, title, normalized_title, category_id, category_path,
      condition_text, buying_options, item_web_url, image_url, seller_username, seller_feedback_score,
      price_usd, shipping_usd, title_similarity_score, identifier_match_score,
      condition_match_score, category_match_score, overall_comp_score, status, rejection_reason_code,
      raw_payload_json, created_at
    )
    values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,now()
    )
    on conflict do nothing
    `,
    [
      context.candidateId,
      searchJobId,
      detail.itemId,
      identity.epid,
      detail.title,
      normalizeNullableText(detail.title),
      identity.preferredCategoryId,
      identity.preferredCategoryPath,
      detail.condition,
      detail.buyingOptions,
      detail.itemWebUrl,
      detail.imageUrl,
      detail.sellerUsername,
      detail.sellerFeedbackScore ?? null,
      detail.priceValue ?? 0,
      detail.shippingValue ?? 0,
      // total_price_usd removed — it's a GENERATED ALWAYS column
      identity.titleScore,
      identity.identityScore,
      identity.conditionScore,
      identity.categoryScore,
      identity.overallScore,
      acceptanceStatus,
      rejectionReasonCode,
      JSON.stringify({
        analysisProng: ANALYSIS_PRONG,
        localizedAspects: detail.localizedAspects,
        product: product ?? null,
        taxonomy: taxonomy ?? null,
        matchReasonJson: identity.gateReasons,
      }),
    ],
  );

  await pool.query(
    `
    insert into arb.ebay_comp_item (
      listing_id, ebay_market_data_id, ebay_item_id, ebay_legacy_item_id, title, condition_text, condition_id,
      item_web_url, image_url, seller_username, seller_feedback_percentage, seller_feedback_score, buying_options,
      price_value, price_currency, shipping_value, shipping_currency, total_price_estimate, item_location_country,
      item_location_state, category_id, category_path, listing_type, item_creation_date, item_end_date, raw_item_json,
      fetched_at, created_at, source_listing_normalized_id, candidate_id, search_job_id, analysis_prong, comp_type, epid,
      gtins_json, brand, model, mpn, localized_aspects_json, product_title, product_brand, product_description,
      product_identifiers_json, aspect_groups_json, additional_image_urls, short_description_text, description_text,
      category_tree_id, taxonomy_aspects_json, identity_confidence, identity_source, match_score, match_reason_json,
      detail_fetched_at
    )
    values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,
      now(),now(),$27,$28,$29,$30,$31,$32,$33::jsonb,$34,$35,$36,$37::jsonb,$38,$39,$40,$41::jsonb,$42::jsonb,$43::jsonb,
      $44,$45,$46,$47::jsonb,$48,'browse+detail+catalog',$49,$50::jsonb,now()
    )
    on conflict do nothing
    `,
    [
      context.sourceListingNormalizedId,
      marketSearchId,
      detail.itemId,
      detail.legacyItemId,
      detail.title,
      detail.condition,
      detail.conditionId,
      detail.itemWebUrl,
      detail.imageUrl,
      detail.sellerUsername,
      detail.sellerFeedbackPercentage ?? null,
      detail.sellerFeedbackScore ?? null,
      detail.buyingOptions,
      detail.priceValue,
      detail.priceCurrency,
      detail.shippingValue,
      detail.shippingCurrency,
      detail.totalPriceValue,
      detail.itemLocationCountry,
      detail.itemLocationState,
      identity.preferredCategoryId,
      identity.preferredCategoryPath,
      detail.buyingOptions.join(','),
      detail.itemCreationDate,
      detail.itemEndDate,
      JSON.stringify(detail.raw),
      context.sourceListingNormalizedId,
      context.candidateId,
      searchJobId,
      ANALYSIS_PRONG,
      compType,
      identity.epid,
      JSON.stringify(identity.gtins),
      identity.normalizedBrand,
      identity.normalizedModel,
      identity.normalizedMpn,
      JSON.stringify(detail.localizedAspects),
      product?.title ?? null,
      product?.brand ?? null,
      product?.description ?? null,
      JSON.stringify({
        gtins: product?.gtins ?? [],
        mpns: product?.mpns ?? [],
        epid: product?.epid ?? null,
      }),
      JSON.stringify(product?.aspects ?? []),
      JSON.stringify([detail.imageUrl, ...(detail.additionalImages ?? [])].filter(Boolean)),
      detail.shortDescription ?? null,
      detail.description ?? null,
      taxonomy?.categoryTreeId ?? null,
      JSON.stringify(taxonomy ?? {}),
      identity.identityScore,
      identity.overallScore,
      JSON.stringify(identity.gateReasons),
    ],
  );
}

async function persistCompSet(
  pool: Pool,
  context: ListingContext,
  correlationId: string,
  assessment: MarketAssessment,
  decision: ReturnType<typeof computeDecision>,
): Promise<void> {

  await pool.query(
    `
    insert into arb.ebay_comp_set (
      source_listing_normalized_id, run_id, sold_comp_count, active_comp_count,
      median_sold_price, median_total_sold_price, active_median_price, sell_through_rate,
      estimated_days_to_sell, confidence_score, analysis_notes, updated_at, analysis_prong,
      accepted_sold_comp_count, manual_review_comp_count, rejected_sold_comp_count,
      avg_identity_match_score, avg_overall_comp_score, identity_gate_passed, identity_gate_reason_json
    )
    values (
      $1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now(),$12,$13,$14,$15,$16,$17,$18,$19::jsonb
    )
    on conflict (source_listing_normalized_id)
    do update set
      run_id = excluded.run_id,
      sold_comp_count = excluded.sold_comp_count,
      active_comp_count = excluded.active_comp_count,
      median_sold_price = excluded.median_sold_price,
      median_total_sold_price = excluded.median_total_sold_price,
      active_median_price = excluded.active_median_price,
      sell_through_rate = excluded.sell_through_rate,
      estimated_days_to_sell = excluded.estimated_days_to_sell,
      confidence_score = excluded.confidence_score,
      analysis_notes = excluded.analysis_notes,
      updated_at = now(),
      analysis_prong = excluded.analysis_prong,
      accepted_sold_comp_count = excluded.accepted_sold_comp_count,
      manual_review_comp_count = excluded.manual_review_comp_count,
      rejected_sold_comp_count = excluded.rejected_sold_comp_count,
      avg_identity_match_score = excluded.avg_identity_match_score,
      avg_overall_comp_score = excluded.avg_overall_comp_score,
      identity_gate_passed = excluded.identity_gate_passed,
      identity_gate_reason_json = excluded.identity_gate_reason_json
    `,
    [
      context.sourceListingNormalizedId,
      correlationId,
      assessment.acceptedSoldComps.length + assessment.watchSoldComps.length + assessment.rejectedSoldComps.length,
      assessment.activeComps.length,
      assessment.medianAcceptedSoldPrice,
      assessment.medianAcceptedTotalSoldPrice,
      assessment.medianActivePrice,
      assessment.sellThroughRate,
      assessment.estimatedDaysToSell,
      avgOverallScore(assessment.acceptedSoldComps),
      JSON.stringify({
        acceptedSoldCompCount: assessment.acceptedSoldComps.length,
        watchSoldCompCount: assessment.watchSoldComps.length,
        rejectedSoldCompCount: assessment.rejectedSoldComps.length,
        decision: decision.decision,
      }),
      ANALYSIS_PRONG,
      assessment.acceptedSoldComps.length,
      assessment.watchSoldComps.length,
      assessment.rejectedSoldComps.length,
      averageIdentityScore(assessment.acceptedSoldComps),
      avgOverallScore(assessment.acceptedSoldComps),
      decision.decision !== 'REJECT',
      JSON.stringify(decision.reasonJson),
    ],
  );
}

function averageIdentityScore(records: HydratedCompRecord[]): number | null {
  if (records.length === 0) return null;
  return roundNumber(records.reduce((sum, record) => sum + record.identity.identityScore, 0) / records.length, 4);
}

async function persistMarketAndDecision(
  pool: Pool,
  context: ListingContext,
  correlationId: string,
  listing: ListingJob,
  query: string,
  assessment: MarketAssessment,
  decision: ReturnType<typeof computeDecision>,
  searchJobId: number,
): Promise<void> {
  await pool.query(
    `
    insert into arb.ebay_market (
      listing_id, query_text, sold_30d, active_count, median_sold_price, median_active_price,
      resale_anchor_price, liquidity_ratio, confidence, sold_prices_json, active_prices_json,
      sold_sample_json, active_sample_json, correlation_id, updated_at
    )
    values (
      $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,now()
    )
    on conflict (listing_id)
    do update set
      query_text = excluded.query_text,
      sold_30d = excluded.sold_30d,
      active_count = excluded.active_count,
      median_sold_price = excluded.median_sold_price,
      median_active_price = excluded.median_active_price,
      resale_anchor_price = excluded.resale_anchor_price,
      liquidity_ratio = excluded.liquidity_ratio,
      confidence = excluded.confidence,
      sold_prices_json = excluded.sold_prices_json,
      active_prices_json = excluded.active_prices_json,
      sold_sample_json = excluded.sold_sample_json,
      active_sample_json = excluded.active_sample_json,
      correlation_id = excluded.correlation_id,
      updated_at = now()
    `,
    [
      listing.id,
      query,
      assessment.acceptedSoldComps.length,
      assessment.activeComps.length,
      assessment.medianAcceptedSoldPrice,
      assessment.medianActivePrice,
      assessment.medianAcceptedTotalSoldPrice ?? assessment.medianAcceptedSoldPrice,
      assessment.sellThroughRate,
      decision.decision === 'BUY' ? 'HIGH' : decision.decision === 'WATCH' ? 'MEDIUM' : 'LOW',
      JSON.stringify(assessment.acceptedSoldComps.map((item) => item.detail.totalPriceValue ?? item.detail.priceValue)),
      JSON.stringify(assessment.activeComps.map((item) => item.detail.priceValue)),
      JSON.stringify(assessment.acceptedSoldComps.map((item) => ({
        itemId: item.detail.itemId,
        title: item.detail.title,
        overallScore: item.identity.overallScore,
      }))),
      JSON.stringify(assessment.activeComps.map((item) => ({
        itemId: item.detail.itemId,
        title: item.detail.title,
        overallScore: item.identity.overallScore,
      }))),
      correlationId,
    ],
  );

    // arb.decisions writes are owned by profitAnalysisWorker (post-comp profitability layer).
  // PRONG1 only persists comp evidence (ebay_comps, ebay_comp_set). Decisions are derived
  // by profitAnalysisWorker once accepted_comp_count >= MIN_ACCEPTED_COMPS.
}

async function createSearchJob(
  pool: Pool,
  context: ListingContext,
  query: string,
  correlationId: string,
  listing: ListingJob,
): Promise<number> {
  const result = await pool.query(
    `
    insert into arb.ebay_search_jobs (
      candidate_id, job_type, status, api_source, run_context, search_plan_json,
      request_meta_json, result_summary_json, attempt_count, priority, correlation_id,
      started_at, created_at, updated_at, analysis_prong
    )
    values (
      $1,'candidate_comp','running','hybrid','compAnalysisWorker',$2::jsonb,$3::jsonb,'{}'::jsonb,
      1,$4,$5::uuid,now(),now(),now(),$6
    )
    on conflict do nothing
    returning id
    `,
    [
      context.candidateId,
      JSON.stringify({ query, categoryId: listing.categoryId }),
      JSON.stringify({ listingId: listing.id, listingExternalId: listing.listingExternalId }),
      listing.priority ?? 100,
      correlationId,
      ANALYSIS_PRONG,
    ],
  );

  if (result.rows.length > 0) {
    return Number(result.rows[0].id);
  }

    // Conflict: an active job already exists for this candidate — reuse it
  // (widen status filter: the conflicting job may be queued or completed-but-still-held)
  const existing = await pool.query(
    `SELECT id FROM arb.ebay_search_jobs
     WHERE candidate_id = $1
       AND job_type = 'candidate_comp'
     ORDER BY created_at DESC
     LIMIT 1`,
    [context.candidateId],
  );
  if (existing.rows.length === 0) {
    throw new Error(
      `createSearchJob: INSERT skipped via ON CONFLICT but no existing row found for candidate_id=${context.candidateId}`,
    );
  }
  return Number(existing.rows[0].id);
}

async function persistMarketSearch(
  pool: Pool,
  searchJobId: number,
  context: ListingContext,
  correlationId: string,
  listing: ListingJob,
  query: string,
  result: BrowseSearchResult,
  searchType: 'SOLD' | 'ACTIVE',
): Promise<number> {
  const record = await pool.query(
    `
    insert into arb.ebay_market_search (
      run_id, search_type, source, query_text, category_id, condition_filters, listing_format_filters,
      page_no, request_payload, response_status, response_payload, fetched_count, created_at,
      analysis_prong, search_purpose, listing_id, candidate_id, source_listing_normalized_id
    )
    values (
      $1::uuid,$2,'EBAY',$3,$4,'{}'::jsonb,'{}'::jsonb,1,$5::jsonb,200,$6::jsonb,$7,now(),$8,'COMP_SHORTLIST',$9::uuid,$10,$11
    )
    returning id
    `,
    [
      correlationId,
      searchType,
      query,
      listing.categoryId,
      JSON.stringify({ query, searchType }),
      JSON.stringify(result),
      result.itemSummaries.length,
      ANALYSIS_PRONG,
      context.listingId,
      context.candidateId,
      context.sourceListingNormalizedId,
    ],
  );
  return Number(record.rows[0].id);
}

async function resolveListingContext(pool: Pool, listing: ListingJob): Promise<ListingContext> {
  const normalizedResult = listing.listingExternalId
    ? await pool.query(
        `select id from arb.listing_normalized where listing_external_id = $1 order by id desc limit 1`,
        [listing.listingExternalId],
      )
    : { rowCount: 0, rows: [] as Array<{ id?: unknown }> };
  return {
    listingId: listing.id,
    listingExternalId: listing.listingExternalId,
    candidateId: listing.candidateId,
    sourceListingNormalizedId: normalizedResult.rowCount ? Number(normalizedResult.rows[0].id) : null,
  };
}
async function claimNextListing(pool: Pool, logger: Logger): Promise<ListingJob | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `
      with candidate as (
        select
          l.id, l.listing_external_id, l.title, l.normalized_title, l.description_raw,
          l.brand, l.model, l.variant, l.category_id, l.condition_text, l.current_price,
          l.buy_now_price, l.current_bid_price, l.inbound_shipping_usd, l.total_cost,
                    l.priority, coalesce(l.comp_attempts, 0) as comp_attempts, coalesce(l.comp_status, 'pending') as comp_status,
                    ca.id as candidate_id
        from arb.listings l
join lateral (
  select ca.*
  from arb.candidates ca
  where ca.listing_id = l.id
  order by ca.id desc
  limit 1
) ca on true
where coalesce(l.next_comp_attempt_at, now()) <= now()
  and (
    coalesce(l.comp_status, 'pending') in ('pending', 'retry')
    or l.comp_status = 'processing'
    or (
      ca.status = 'matched'
      and ca.lifecycle_status = 'RECOVERED_NEEDS_EBAY_SEARCH'
      and not exists (
        select 1
        from arb.ebay_comps ec
        where ec.candidate_id = ca.id
      )
    )
  )
          and (l.comp_locked_at is null or l.comp_locked_at < now() - make_interval(secs => $1::int))
        order by
          (l.end_time is not null and l.end_time > now()) desc,            -- live auctions first
          case when l.end_time > now() then l.end_time end asc nulls last, -- soonest-closing live first
          coalesce(l.priority, 1000) asc, l.id asc
        limit 1
        for update skip locked
      )
      update arb.listings l
         set comp_status = 'processing',
             comp_locked_at = now(),
             comp_locked_by = $2,
             comp_started_at = coalesce(l.comp_started_at, now()),
             comp_updated_at = now(),
             comp_attempts = coalesce(l.comp_attempts, 0) + 1
      from candidate c
      where l.id = c.id
      returning
        l.id, l.listing_external_id, l.title, l.normalized_title, l.description_raw,
        l.brand, l.model, l.variant, l.category_id, l.condition_text, l.current_price,
        l.buy_now_price, l.current_bid_price, l.inbound_shipping_usd, l.total_cost, l.priority,
        l.comp_attempts, l.comp_status,
        c.candidate_id
      `,
      [config.lockTtlSeconds, config.workerInstanceId],
    );
    await client.query('COMMIT');
    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    return {
      id: toListingId(row.id, 'ListingJob.id'),
      listingExternalId: row.listing_external_id ? String(row.listing_external_id) : null,
      title: String(row.title ?? ''),
      normalizedTitle: row.normalized_title ? String(row.normalized_title) : null,
      descriptionRaw: row.description_raw ? String(row.description_raw) : null,
      brand: row.brand ? String(row.brand) : null,
      model: row.model ? String(row.model) : null,
      variant: row.variant ? String(row.variant) : null,
      categoryId: row.category_id ? String(row.category_id) : null,
      conditionText: row.condition_text ? String(row.condition_text) : null,
      currentPrice: parseNullableNumber(row.current_price),
      buyNowPrice: parseNullableNumber(row.buy_now_price),
      currentBidPrice: parseNullableNumber(row.current_bid_price),
      inboundShippingUsd: parseNullableNumber(row.inbound_shipping_usd),
      totalCost: parseNullableNumber(row.total_cost),
      priority: row.priority !== null ? Number(row.priority) : null,
      compAttempts: Number(row.comp_attempts ?? 0),
      compStatus: String(row.comp_status ?? 'processing') as CompStatus,
      candidateId: row.candidate_id ? Number(row.candidate_id) : null,
    };
  } catch (error) {
    await safeRollback(client, logger, 'claimNextListing');
    throw error;
  } finally {
    client.release();
  }
}

function buildCompQuery(listing: ListingJob): string | null {
  const parts = [
    listing.brand,
    listing.model,
    listing.variant,
    listing.normalizedTitle,
    listing.title,
  ]
    .filter(Boolean)
    .map((value) => normalizeWhitespace(String(value)))
    .filter((value) => value.length >= 2);

  if (parts.length === 0) return null;

  // Token-level dedup (case-insensitive). Prevents "Apple Apple AirPods Pro".
  const seenTokens = new Set<string>();
  const outputTokens: string[] = [];
  for (const part of parts) {
    for (const token of part.split(/\s+/)) {
      const key = token.toLowerCase();
      if (key.length < 2 || seenTokens.has(key)) continue;
      seenTokens.add(key);
      outputTokens.push(token);
    }
    if (outputTokens.length >= 8) break;
  }

  const query = outputTokens.join(' ');
  return query.length >= 3 ? query : null;
}
async function finalizeSuccess(
  pool: Pool,
  listingId: ListingId,
  meta: {
    correlationId: string;
    query: string;
    searchJobId: number;
    decision: DecisionCode;
    acceptedSoldCompCount: number;
    activeCompCount: number;
    manualReviewCompCount?: number;
    rejectedSoldCompCount?: number;
    medianAcceptedSoldPrice?: number | null;
    medianAcceptedTotalSoldPrice?: number | null;
    medianActivePrice?: number | null;
    sellThroughRate?: number | null;
    estimatedDaysToSell?: number | null;
    avgIdentityMatchScore?: number | null;
    avgOverallCompScore?: number | null;
    identityGatePassed?: boolean;
    identityGateReason?: Record<string, unknown>;
    expectedResaleUsd?: number | null;
    estimatedProfitUsd?: number | null;
    estimatedRoi?: number | null;
    durationMs: number;
    analysisProng: AnalysisProng;
    pricingMethod?: 'sold_median' | 'active_max' | 'active_median' | 'none';
    product?: {
      epid: string | null;
      title: string | null;
      brand: string | null;
      gtins: string[] | null;
      mpns: string[] | null;
    } | null;
  },
): Promise<void> {
  await pool.query(
    `
    update arb.listings
       set comp_status = 'completed',
           comp_completed_at = now(),
           comp_updated_at = now(),
           comp_locked_at = null,
           comp_locked_by = null,
           next_comp_attempt_at = null,
           comp_last_error = null,
           comp_last_error_class = null,
           comp_result_json = coalesce(comp_result_json, '{}'::jsonb) || $2::jsonb
     where id = $1::uuid
    `,
    [listingId, JSON.stringify(meta)],
  );
}

async function markListingForRetry(
  pool: Pool,
  listingId: ListingId,
  input: { nextAttemptAt: Date; failureReason: string; failureClass: string },
): Promise<void> {
  await pool.query(
    `
    update arb.listings
       set comp_status = 'retry',
           comp_updated_at = now(),
           comp_locked_at = null,
           comp_locked_by = null,
           next_comp_attempt_at = $2,
           comp_last_error = left($3, 1000),
           comp_last_error_class = left($4, 128)
     where id = $1::uuid
    `,
    [listingId, input.nextAttemptAt.toISOString(), input.failureReason, input.failureClass],
  );
}

async function markListingTerminal(
  pool: Pool,
  listingId: ListingId,
  input: { terminalState: Extract<CompStatus, 'dead_letter'>; failureReason: string; failureClass: string; meta?: Record<string, unknown> },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `
      update arb.listings
         set comp_status = $2,
             comp_updated_at = now(),
             comp_locked_at = null,
             comp_locked_by = null,
             next_comp_attempt_at = null,
             comp_last_error = left($3, 1000),
             comp_last_error_class = left($4, 128),
             comp_result_json = coalesce(comp_result_json, '{}'::jsonb) || $5::jsonb
       where id = $1::uuid
      `,
      [
        listingId,
        input.terminalState,
        input.failureReason,
        input.failureClass,
        JSON.stringify({
          failureReason: input.failureReason,
          failureClass: input.failureClass,
          ...(input.meta ?? {}),
        }),
      ],
    );

    await client.query(
      `
      insert into arb.comp_dead_letter (listing_id, failure_reason, failure_class, error_json, created_at)
      values ($1::uuid,$2,$3,$4::jsonb,now())
      `,
      [listingId, input.failureReason, input.failureClass, JSON.stringify(input.meta ?? {})],
    );

    await client.query('COMMIT');
  } catch (error) {
    await safeRollback(client, createFallbackLogger(), 'markListingTerminal');
    throw error;
  } finally {
    client.release();
  }
}

async function writeHeartbeat(
  pool: Pool,
  logger: Logger,
  input: { status: WorkerHeartbeatStatus; details: Record<string, unknown> },
): Promise<void> {
  try {
    await pool.query(
      `
      insert into arb.worker_heartbeats (
        worker_name, worker_instance_id, status, details_json, last_seen_at
      )
      values ($1,$2,$3,$4::jsonb,now())
      on conflict (worker_name, worker_instance_id)
      do update set
        status = excluded.status,
        details_json = excluded.details_json,
        last_seen_at = now()
      `,
      [config.workerName, config.workerInstanceId, input.status, JSON.stringify(input.details)],
    );
  } catch (error) {
    logger.warn('failed to write heartbeat', { operation: 'writeHeartbeat', error: serializeError(error) });
  }
}

function trimOutliers(sortedValues: number[], lowerPct = 0.1, upperPct = 0.1): number[] {
  if (sortedValues.length < 5) return sortedValues;
  const n = sortedValues.length;
  const lo = Math.floor(n * lowerPct);
  const hi = Math.ceil(n * (1 - upperPct));
  return sortedValues.slice(lo, hi);
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  if (values.length === 1) return roundNumber(values[0]!, 2);
  const pos = (values.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = values[base]!;
  const upper = values[base + 1] ?? lower;
  return roundNumber(lower + rest * (upper - lower), 2);
}

function roundNullable(value: number | null, places = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return roundNumber(value, places);
}

function roundNumber(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function isRetryableWorkerError(error: unknown): boolean {
  if (error && typeof error === 'object' && (error as { retryable?: boolean }).retryable === true) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('timeout') || msg.includes('network') || msg.includes('fetch') || msg.includes('429') || msg.includes('throttle');
  }
  return false;
}

function classifyWorkerError(error: unknown): string {
  if (!error) return 'UNKNOWN';
  if (typeof error === 'object') {
    const candidate = error as { classification?: string; status?: number };
    if (candidate.classification) return String(candidate.classification).toUpperCase();
    if (candidate.status === 429) return 'THROTTLED';
    if (candidate.status === 401 || candidate.status === 403) return 'AUTH';
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('timeout')) return 'TIMEOUT';
    if (msg.includes('network') || msg.includes('fetch')) return 'NETWORK';
    if (msg.includes('deadlock') || msg.includes('serialize')) return 'DB_CONCURRENCY';
    if (msg.includes('invalid')) return 'INVALID_INPUT';
  }
  return 'UNCLASSIFIED';
}

function computeRetryDelayMs(attempts: number): number {
  const boundedAttempt = Math.min(Math.max(attempts, 1), 8);
  const base = 30_000 * 2 ** (boundedAttempt - 1);
  const jitter = Math.floor(Math.random() * 5_000);
  return Math.min(base + jitter, 60 * 60 * 1000);
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? truncate(error.message, 1000) : truncate(String(error), 1000);
}

async function safeRollback(client: PoolClient, logger: Logger, operation: string): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    logger.error('rollback failed', { operation, error: serializeError(rollbackError) });
  }
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('Missing DATABASE_URL');

  return new Pool({
    connectionString,
    max: getIntEnv('PG_POOL_MAX', 10),
    idleTimeoutMillis: getIntEnv('PG_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMillis: getIntEnv('PG_CONNECTION_TIMEOUT_MS', 10000),
    statement_timeout: getIntEnv('PG_STATEMENT_TIMEOUT_MS', 30000),
    query_timeout: getIntEnv('PG_QUERY_TIMEOUT_MS', 30000),
    application_name: `${config.workerName}:${config.workerInstanceId}`,
    ssl: getBoolEnv('PG_SSL_ENABLED', true) ? { rejectUnauthorized: false } : false,
  } as Record<string, unknown>);
}

function createFallbackLogger(): Logger {
  return createLogger({
    serviceName: config.applicationName,
    staticBindings: {
      component: 'compAnalysisWorkerFallback',
      workerName: config.workerName,
      workerInstanceId: config.workerInstanceId,
      analysisProng: ANALYSIS_PRONG,
    },
  });
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeWhitespace(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function getIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toListingId(value: unknown, fieldName = 'listingId'): ListingId {
  const str = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  assertListingId(str, fieldName);
  return str as ListingId;
}

function assertListingId(value: unknown, fieldName = 'listingId'): asserts value is ListingId {
  const str = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(str)) {
    throw new Error(`Invalid UUID for ${fieldName}: ${String(value)}`);
  }
}

if (require.main === module) {
  const logger = createLogger({
    serviceName: config.applicationName,
    staticBindings: {
      component: 'compAnalysisWorker',
      workerName: config.workerName,
      workerInstanceId: config.workerInstanceId,
      analysisProng: ANALYSIS_PRONG,
    },
  });

  const abortController = new AbortController();

  const shutdown = (signal: string): void => {
    logger.warn('signal received, shutting down', { operation: 'processSignal', signal });
    abortController.abort();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  runCompAnalysisWorker({ signal: abortController.signal, logger })
    .then(() => {
      logger.info('worker exited cleanly', { operation: 'processExit' });
      process.exit(0);
    })
    .catch((error) => {
      logger.error('worker exited with fatal error', { operation: 'processExit', error: serializeError(error) });
      process.exit(1);
    });
}
