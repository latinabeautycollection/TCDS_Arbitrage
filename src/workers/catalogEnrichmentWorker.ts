import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createEbayClient, type EbayClient, type CatalogProductSummary } from '../services/ebayClient';
import { createLogger } from '../services/logger';

const WORKER_NAME = process.env.CATALOG_ENRICHMENT_WORKER_NAME ?? 'catalog-enrichment-worker';
const WORKER_INSTANCE_ID = crypto.randomUUID();
const POLL_INTERVAL_MS = parseInt(process.env.CATALOG_ENRICHMENT_POLL_MS ?? '30000', 10);
const EMPTY_POLL_MS = parseInt(process.env.CATALOG_ENRICHMENT_EMPTY_POLL_MS ?? '300000', 10);
const BATCH_SIZE = parseInt(process.env.CATALOG_ENRICHMENT_BATCH_SIZE ?? '10', 10);
const RATE_LIMIT_MS = parseInt(process.env.CATALOG_ENRICHMENT_RATE_LIMIT_MS ?? '1000', 10);
const REATTEMPT_DAYS = parseInt(process.env.CATALOG_ENRICHMENT_REATTEMPT_DAYS ?? '7', 10);
const MIN_TITLE_SIM = parseFloat(process.env.CATALOG_ENRICHMENT_MIN_TITLE_SIM ?? '0.30');
const MIN_TITLE_LEN = parseInt(process.env.CATALOG_ENRICHMENT_MIN_TITLE_LEN ?? '10', 10);
const MAX_QUERY_LEN = 150;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const logger = createLogger({
  serviceName: process.env.APP_SERVICE_NAME ?? 'arb-system-api',
  staticBindings: {
    component: 'catalogEnrichmentWorker',
    workerName: WORKER_NAME,
    workerInstanceId: WORKER_INSTANCE_ID,
  },
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_POOL_MAX ?? '5', 10),
  idleTimeoutMillis: 30000,
  ssl: { rejectUnauthorized: false },
  application_name: `${WORKER_NAME}:${WORKER_INSTANCE_ID}`,
});

const ebayClient: EbayClient = createEbayClient({ logger });

interface EligibleCandidate {
  id: number;
  title: string | null;
  normalized_title: string | null;
  brand: string | null;
  model: string | null;
  mpn: string | null;
}

async function fetchEligibleCandidates(limit: number): Promise<EligibleCandidate[]> {
  // REATTEMPT_DAYS comes from parseInt of an env var; clamp to a sane range and inline
  // (avoids prepared-statement type-inference issues on the interval expression)
  const reattemptDays = Math.max(1, Math.min(365, REATTEMPT_DAYS));
  const { rows } = await pool.query<EligibleCandidate>(
    `
    select c.id, c.title, c.normalized_title, c.brand, c.model, c.mpn
    from arb.candidates c
    join arb.listings l on l.id = c.listing_id
    where l.comp_status = 'completed'
      and (
        (c.brand is null or c.brand = '')
        or (c.model is null or c.model = '')
        or (c.mpn is null or c.mpn = '')
      )
      and (
        c.catalog_enrichment_attempted_at is null
        or c.catalog_enrichment_attempted_at < now() - interval '${reattemptDays} days'
      )
      and length(coalesce(c.normalized_title, c.title, '')) >= $1
    order by c.catalog_enrichment_attempted_at nulls first, c.id asc
    limit $2
    `,
    [MIN_TITLE_LEN, limit]
  );
  return rows;
}
function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function jaccard(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : inter / union;
}

function findAspectValue(aspects: unknown[], aspectName: string): string | null {
  if (!Array.isArray(aspects)) return null;
  const target = aspectName.toLowerCase();
  for (const a of aspects) {
    const aRec = a as Record<string, unknown> | null;
    if (!aRec) continue;
    const name = String(aRec.localizedName ?? aRec.name ?? '').toLowerCase();
    if (name !== target) continue;
    const values = (aRec.localizedValues ?? aRec.values) as unknown[] | undefined;
    if (!Array.isArray(values) || values.length === 0) continue;
    const first = values[0];
    if (typeof first === 'string') return first.trim();
    if (first && typeof first === 'object') {
      const fRec = first as Record<string, unknown>;
      const v = fRec.localizedValue ?? fRec.value;
      if (typeof v === 'string') return v.trim();
    }
  }
  return null;
}

function brandAppearsInTitle(brand: string, title: string): boolean {
  const brandLower = brand.trim().toLowerCase();
  if (brandLower.length === 0) return false;
  return title.toLowerCase().includes(brandLower);
}

function isQualityValue(value: string | null | undefined, type: 'brand' | 'model' | 'mpn'): boolean {
  if (!value) return false;
  const v = value.trim();
  if (type === 'brand') return v.length >= 2;
  if (type === 'model') return v.length >= 4 && /[a-zA-Z]/.test(v) && /[0-9]/.test(v);
  if (type === 'mpn') return v.length >= 4 && /[0-9]/.test(v);
  return false;
}

async function stampAttempted(candidateId: number): Promise<void> {
  await pool.query(
    `update arb.candidates set catalog_enrichment_attempted_at = now() where id = $1`,
    [candidateId],
  );
}

interface EnrichOutcome {
  enriched: boolean;
  reason: string;
  setBrand?: string | null;
  setModel?: string | null;
  setMpn?: string | null;
  bestScore?: number;
  resultCount?: number;
}

async function enrichCandidate(c: EligibleCandidate): Promise<EnrichOutcome> {
  const queryTitle = (c.normalized_title ?? c.title ?? '').slice(0, MAX_QUERY_LEN).trim();
  if (queryTitle.length < MIN_TITLE_LEN) {
    await stampAttempted(c.id);
    return { enriched: false, reason: 'title_too_short' };
  }

  const correlationId = crypto.randomUUID();
  let results: CatalogProductSummary[];
  try {
    results = await ebayClient.searchCatalogProducts({
      q: queryTitle,
      limit: 5,
      correlationId,
    });
  } catch (err) {
    logger.warn('catalog search failed', {
      candidateId: c.id,
      error: err instanceof Error ? err.message : String(err),
    });
    await stampAttempted(c.id);
    return { enriched: false, reason: 'search_failed' };
  }

  if (results.length === 0) {
    await stampAttempted(c.id);
    return { enriched: false, reason: 'no_results' };
  }

  const scored = results
    .map((r) => ({ result: r, score: jaccard(queryTitle, r.title ?? '') }))
    .filter((x) => x.score >= MIN_TITLE_SIM)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    await stampAttempted(c.id);
    return { enriched: false, reason: 'no_quality_match', resultCount: results.length };
  }

  const best = scored[0]!;
  const r = best.result;

  const candidateBrand =
    isQualityValue(r.brand, 'brand') && brandAppearsInTitle(r.brand!, queryTitle)
      ? r.brand!.trim()
      : null;
  const candidateMpn = r.mpns.find((m) => isQualityValue(m, 'mpn')) ?? null;
  const candidateModelRaw = findAspectValue(r.aspects as unknown[], 'Model');
  const candidateModel = isQualityValue(candidateModelRaw, 'model') ? candidateModelRaw : null;

  if (!candidateBrand && !candidateModel && !candidateMpn) {
    await stampAttempted(c.id);
    return { enriched: false, reason: 'no_quality_fields', bestScore: best.score };
  }

    await pool.query(
    `
    update arb.candidates
    set
      brand = case when (brand is null or brand = '') and $2::text is not null then $2::text else brand end,
      model = case when (model is null or model = '') and $3::text is not null then $3::text else model end,
      mpn   = case when (mpn   is null or mpn   = '') and $4::text is not null then $4::text else mpn end,
      catalog_enrichment_attempted_at = now(),
      updated_at = now()
    where id = $1::bigint
    `,
    [c.id, candidateBrand, candidateModel, candidateMpn],
  );

  return {
    enriched: true,
    reason: 'ok',
    setBrand: candidateBrand,
    setModel: candidateModel,
    setMpn: candidateMpn,
    bestScore: best.score,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function processBatch(): Promise<{ attempted: number; enriched: number; skipped: number }> {
  const candidates = await fetchEligibleCandidates(BATCH_SIZE);
  if (candidates.length === 0) return { attempted: 0, enriched: 0, skipped: 0 };

  let enriched = 0;
  let skipped = 0;

  for (const c of candidates) {
    const result = await enrichCandidate(c);
    if (result.enriched) {
      enriched++;
      logger.info('candidate enriched', {
        candidateId: c.id,
        setBrand: result.setBrand,
        setModel: result.setModel,
        setMpn: result.setMpn,
        bestScore: result.bestScore,
      });
    } else {
      skipped++;
    }
    await sleep(RATE_LIMIT_MS);
  }

  return { attempted: candidates.length, enriched, skipped };
}

async function main(): Promise<void> {
  let keepRunning = true;
  const stop = (signal: string) => {
    logger.info('stop requested', { signal });
    keepRunning = false;
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  logger.info('starting', {
    pollIntervalMs: POLL_INTERVAL_MS,
    emptyPollMs: EMPTY_POLL_MS,
    batchSize: BATCH_SIZE,
    rateLimitMs: RATE_LIMIT_MS,
    minTitleSim: MIN_TITLE_SIM,
    reattemptDays: REATTEMPT_DAYS,
  });

  while (keepRunning) {
    try {
      const stats = await processBatch();
      logger.info('batch processed', stats);
      const sleepMs = stats.attempted === 0 ? EMPTY_POLL_MS : POLL_INTERVAL_MS;
      await sleep(sleepMs);
    } catch (err) {
      logger.error('batch failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(POLL_INTERVAL_MS);
    }
  }

  await pool.end();
  logger.info('stopped');
}

main().catch((err) => {
  console.error('[catalog-enrichment-worker] fatal', err);
  process.exit(1);
});
