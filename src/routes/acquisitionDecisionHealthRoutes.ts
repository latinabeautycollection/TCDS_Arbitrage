import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'pg';
import { AcquisitionDecisionHealthRepository } from '../repositories/acquisitionDecisionHealthRepository';

export interface AcquisitionDecisionHealthRouterInput {
  pool: Pool;
}

type JsonObject = Record<string, unknown>;

type BuyExecutionStatus =
  | 'AUTO_BUY_READY'
  | 'BID_MONITOR_READY'
  | 'REVIEW_REQUIRED'
  | 'BLOCKED'
  | 'EXPIRED'
  | 'CAPITAL_LIMIT_SKIPPED'
  | 'UNCLASSIFIED';

type PurchaseQueueStatus =
  | 'approved'
  | 'approved_pending_bid_check'
  | 'bid_monitor'
  | 'review_required'
  | 'blocked'
  | 'not_queued'
  | 'unknown';

const DEFAULT_WORKER_NAME = 'acquisition-decision-worker';
const SERVICE_NAME = 'acquisition-decision-engine';

/**
 * Domain 1 Acquisition Decision Health Routes — Green Tier 1.
 *
 * These routes are hardened for the incident class we diagnosed:
 * BUY decisions exist, but capital safety / execution state prevents purchase queue handoff.
 *
 * Route contract:
 * - GET /health         lightweight liveness
 * - GET /ready          deep readiness based on health repository snapshot
 * - GET /handoff        BUY -> capital safety -> purchase_queue forensic view
 * - GET /blocked-buys   latest BUY decisions blocked by hard/soft capital safety reasons
 * - GET /metrics        Prometheus metrics from the real DB snapshot, not only in-memory counters
 */
export function createAcquisitionDecisionHealthRouter(input: AcquisitionDecisionHealthRouterInput): Router {
  const router = Router();
  const repo = new AcquisitionDecisionHealthRepository(input.pool);
  const workerName = process.env.ACQ_DECISION_WORKER_NAME?.trim() || DEFAULT_WORKER_NAME;

  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      contract: 'domain1.acquisition-decision.health.v2',
    });
  });

  router.get(
    '/ready',
    asyncHandler(async (_req: Request, res: Response) => {
      const snapshot = await repo.getHealthSnapshot(workerName);
      res.status(snapshot.status === 'FAIL' ? 503 : 200).json({
        ...snapshot,
        service: SERVICE_NAME,
        workerName,
      });
    }),
  );

  router.get(
    '/handoff',
    asyncHandler(async (req: Request, res: Response) => {
      const hours = clampInt(req.query.hours, 1, 168, 24);
      const limit = clampInt(req.query.limit, 1, 250, 50);
      const result = await input.pool.query(
        `
        with p as (
          select now() - ($1::int || ' hours')::interval as since_ts
        ),
        buys as (
          select
            d.id,
            d.listing_id,
            d.decision::text as decision,
            d.capital_safe,
            d.capital_block_reason_json,
            d.reasons_json,
            coalesce(d.capital_block_reason_json->>'status', d.reasons_json->>'capitalStatus') as capital_status,
            coalesce(d.capital_block_reason_json->>'executionStatus', d.reasons_json->>'executionStatus') as execution_status,
            coalesce(d.capital_block_reason_json->>'purchaseQueueStatus', d.reasons_json->>'purchaseQueueStatus') as purchase_queue_status,
            coalesce(d.capital_block_reason_json->'hardBlockReasons', d.capital_block_reason_json->'reasons', '[]'::jsonb) as hard_block_reasons,
            coalesce(d.capital_block_reason_json->'softReviewReasons', d.reasons_json->'softReviewReasons', '[]'::jsonb) as soft_review_reasons,
            coalesce(d.estimated_profit_usd, d.expected_net_profit) as estimated_profit_usd,
            coalesce(d.estimated_roi, d.expected_roi) as estimated_roi,
            d.max_bid_usd,
            d.created_at,
            d.computed_at
          from arb.decisions d, p
          where d.decision::text = 'BUY'
            and (d.created_at >= p.since_ts or d.computed_at >= p.since_ts)
        ),
        enriched as (
          select
            b.*,
            l.listing_external_id,
            l.title,
            l.status::text as listing_status,
            l.end_time,
            ln.id as source_listing_normalized_id,
            c.id as candidate_id,
            oq.id as opportunity_queue_id,
            oq.status as opportunity_status,
            csg.id as capital_safety_gate_id,
            csg.gate_status,
            csg.block_reasons,
            pq.id as purchase_queue_id,
            pq.queue_status,
            pq.approved_at,
            pq.purchased_at
          from buys b
          left join arb.listings l on l.id = b.listing_id
          left join arb.listing_normalized ln on ln.listing_external_id = l.listing_external_id
          left join arb.candidates c on c.listing_id = b.listing_id
          left join arb.opportunity_queue oq on oq.candidate_id = c.id
          left join arb.capital_safety_gate csg on csg.listing_id = b.listing_id
          left join arb.purchase_queue pq on pq.source_listing_normalized_id = ln.id
        )
        select *
        from enriched
        order by created_at desc nulls last, computed_at desc nulls last
        limit $2::int
        `,
        [hours, limit],
      );

      const rows = result.rows.map(normalizeBuyHandoffRow);
      const summary = summarizeHandoff(rows);
      res.status(Number(summary.missingPurchaseQueue) > 0 ? 409 : 200).json({
        ok: summary.missingPurchaseQueue === 0,
        service: SERVICE_NAME,
        checkedAt: new Date().toISOString(),
        windowHours: hours,
        summary,
        rows,
      });
    }),
  );

  router.get(
    '/blocked-buys',
    asyncHandler(async (req: Request, res: Response) => {
      const hours = clampInt(req.query.hours, 1, 720, 168);
      const limit = clampInt(req.query.limit, 1, 250, 100);
      const result = await input.pool.query(
        `
        with p as (
          select now() - ($1::int || ' hours')::interval as since_ts
        )
        select
          d.id as decision_id,
          d.listing_id,
          l.listing_external_id,
          l.title,
          l.status::text as listing_status,
          l.end_time,
          d.decision::text as decision,
          d.capital_safe,
          coalesce(d.capital_block_reason_json->>'status', d.reasons_json->>'capitalStatus') as capital_status,
          coalesce(d.capital_block_reason_json->>'executionStatus', d.reasons_json->>'executionStatus') as execution_status,
          coalesce(d.capital_block_reason_json->>'purchaseQueueStatus', d.reasons_json->>'purchaseQueueStatus') as purchase_queue_status,
          coalesce(d.capital_block_reason_json->'hardBlockReasons', d.capital_block_reason_json->'reasons', '[]'::jsonb) as hard_block_reasons,
          coalesce(d.capital_block_reason_json->'softReviewReasons', d.reasons_json->'softReviewReasons', '[]'::jsonb) as soft_review_reasons,
          coalesce(d.estimated_profit_usd, d.expected_net_profit) as estimated_profit_usd,
          coalesce(d.estimated_roi, d.expected_roi) as estimated_roi,
          d.capital_block_reason_json,
          d.reasons_json,
          d.created_at,
          d.computed_at
        from arb.decisions d
        left join arb.listings l on l.id = d.listing_id
        cross join p
        where d.decision::text = 'BUY'
          and (d.created_at >= p.since_ts or d.computed_at >= p.since_ts)
          and (
            d.capital_safe = false
            or coalesce(d.capital_block_reason_json->>'executionStatus', d.reasons_json->>'executionStatus') in ('BLOCKED', 'EXPIRED', 'CAPITAL_LIMIT_SKIPPED', 'REVIEW_REQUIRED')
          )
        order by coalesce(d.estimated_profit_usd, d.expected_net_profit) desc nulls last, d.created_at desc
        limit $2::int
        `,
        [hours, limit],
      );

      res.status(200).json({
        ok: true,
        service: SERVICE_NAME,
        checkedAt: new Date().toISOString(),
        windowHours: hours,
        count: result.rowCount,
        rows: result.rows,
      });
    }),
  );

  router.get(
    '/metrics',
    asyncHandler(async (_req: Request, res: Response) => {
      const snapshot = await repo.getHealthSnapshot(workerName);
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.status(200).send(renderPrometheusMetrics(snapshot.metrics));
    }),
  );

  router.use(errorHandler);
  return router;
}

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}

function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ROUTE_ERROR';
  res.status(500).json({
    ok: false,
    service: SERVICE_NAME,
    checkedAt: new Date().toISOString(),
    error: message,
  });
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeBuyHandoffRow(row: JsonObject): JsonObject {
  const executionStatus = normalizeExecutionStatus(row.execution_status);
  const purchaseQueueStatus = normalizePurchaseQueueStatus(row.purchase_queue_status ?? row.queue_status);
  const hardBlockReasons = normalizeJsonArray(row.hard_block_reasons ?? row.block_reasons);
  const softReviewReasons = normalizeJsonArray(row.soft_review_reasons);
  const purchaseQueueId = row.purchase_queue_id ?? null;
  const queueEligible = isPurchaseQueueEligible(executionStatus, purchaseQueueStatus);

  return {
    decisionId: row.id,
    listingId: row.listing_id,
    listingExternalId: row.listing_external_id,
    title: row.title,
    listingStatus: row.listing_status,
    endTime: row.end_time,
    candidateId: row.candidate_id,
    opportunityQueueId: row.opportunity_queue_id,
    opportunityStatus: row.opportunity_status,
    capitalSafetyGateId: row.capital_safety_gate_id,
    capitalSafe: row.capital_safe,
    capitalStatus: row.capital_status ?? inferCapitalStatus(executionStatus, hardBlockReasons),
    executionStatus,
    purchaseQueueStatus,
    queueEligible,
    purchaseQueueCreated: purchaseQueueId !== null,
    missingPurchaseQueue: queueEligible && purchaseQueueId === null,
    purchaseQueueId,
    actualQueueStatus: row.queue_status,
    approvedAt: row.approved_at,
    purchasedAt: row.purchased_at,
    hardBlockReasons,
    softReviewReasons,
    estimatedProfitUsd: toNumberOrNull(row.estimated_profit_usd),
    estimatedRoi: toNumberOrNull(row.estimated_roi),
    maxBidUsd: toNumberOrNull(row.max_bid_usd),
    decisionCreatedAt: row.created_at,
    decisionComputedAt: row.computed_at,
  };
}

function normalizeExecutionStatus(value: unknown): BuyExecutionStatus {
  const v = String(value ?? '').trim().toUpperCase();
  if (v === 'AUTO_BUY_READY') return 'AUTO_BUY_READY';
  if (v === 'BID_MONITOR_READY') return 'BID_MONITOR_READY';
  if (v === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED';
  if (v === 'BLOCKED') return 'BLOCKED';
  if (v === 'EXPIRED') return 'EXPIRED';
  if (v === 'CAPITAL_LIMIT_SKIPPED') return 'CAPITAL_LIMIT_SKIPPED';
  return 'UNCLASSIFIED';
}

function normalizePurchaseQueueStatus(value: unknown): PurchaseQueueStatus {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'approved') return 'approved';
  if (v === 'approved_pending_bid_check') return 'approved_pending_bid_check';
  if (v === 'bid_monitor') return 'bid_monitor';
  if (v === 'review_required') return 'review_required';
  if (v === 'blocked') return 'blocked';
  if (v === 'not_queued') return 'not_queued';
  return v ? 'unknown' : 'not_queued';
}

function isPurchaseQueueEligible(executionStatus: BuyExecutionStatus, purchaseQueueStatus: PurchaseQueueStatus): boolean {
  if (executionStatus === 'AUTO_BUY_READY') return true;
  if (executionStatus === 'BID_MONITOR_READY') return true;
  if (executionStatus === 'REVIEW_REQUIRED') return true;
  if (purchaseQueueStatus === 'approved') return true;
  if (purchaseQueueStatus === 'approved_pending_bid_check') return true;
  if (purchaseQueueStatus === 'bid_monitor') return true;
  if (purchaseQueueStatus === 'review_required') return true;
  return false;
}

function normalizeJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') return value ? [value] : [];
  if (value && typeof value === 'object') {
    try {
      const asAny = value as { [key: string]: unknown };
      if (Array.isArray(asAny.reasons)) return asAny.reasons.map(String).filter(Boolean);
    } catch {
      return [];
    }
  }
  return [];
}

function inferCapitalStatus(executionStatus: BuyExecutionStatus, hardBlockReasons: string[]): 'PASS' | 'REVIEW_REQUIRED' | 'BLOCK' | 'UNKNOWN' {
  if (executionStatus === 'AUTO_BUY_READY' || executionStatus === 'BID_MONITOR_READY') return 'PASS';
  if (executionStatus === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED';
  if (executionStatus === 'BLOCKED' || executionStatus === 'EXPIRED' || executionStatus === 'CAPITAL_LIMIT_SKIPPED') return 'BLOCK';
  if (hardBlockReasons.length > 0) return 'BLOCK';
  return 'UNKNOWN';
}

function toNumberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function summarizeHandoff(rows: JsonObject[]): JsonObject {
  const summary = {
    totalBuyDecisions: rows.length,
    queueEligible: 0,
    purchaseQueueCreated: 0,
    missingPurchaseQueue: 0,
    autoBuyReady: 0,
    bidMonitorReady: 0,
    reviewRequired: 0,
    blocked: 0,
    expired: 0,
    capitalLimitSkipped: 0,
    unclassified: 0,
  };

  for (const row of rows) {
    if (row.queueEligible === true) summary.queueEligible += 1;
    if (row.purchaseQueueCreated === true) summary.purchaseQueueCreated += 1;
    if (row.missingPurchaseQueue === true) summary.missingPurchaseQueue += 1;

    switch (row.executionStatus) {
      case 'AUTO_BUY_READY': summary.autoBuyReady += 1; break;
      case 'BID_MONITOR_READY': summary.bidMonitorReady += 1; break;
      case 'REVIEW_REQUIRED': summary.reviewRequired += 1; break;
      case 'BLOCKED': summary.blocked += 1; break;
      case 'EXPIRED': summary.expired += 1; break;
      case 'CAPITAL_LIMIT_SKIPPED': summary.capitalLimitSkipped += 1; break;
      default: summary.unclassified += 1; break;
    }
  }

  return summary;
}

function renderPrometheusMetrics(metrics: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(metrics)) {
    const metricName = `arb_acquisition_${toSnakeCase(key)}`;
    const numeric = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value ?? 0);
    lines.push(`# TYPE ${metricName} gauge`, `${metricName} ${Number.isFinite(numeric) ? numeric : 0}`);
  }
  return `${lines.join('\n')}\n`;
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase();
}
