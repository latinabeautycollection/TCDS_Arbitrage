import type { Pool } from 'pg';

export interface AcquisitionDecisionHealthSnapshot {
  ok: boolean;
  status: 'PASS' | 'WARN' | 'FAIL';
  checkedAt: string;
  metrics: {
    dbReachable: boolean;
    latestHeartbeatAgeSeconds: number | null;
    pendingOpportunities: number;
    staleProcessingOpportunities: number;
    recentDeadLetters: number;
    decisions24h: number;
    buyDecisions24h: number;
    buyCapitalSafe24h: number;
    buyCapitalBlocked24h: number;
    purchaseQueue24h: number;
    purchaseQueueEligibleButMissing24h: number;
    autoBuyReady24h: number;
    bidMonitorReady24h: number;
    reviewRequired24h: number;
    blocked24h: number;
    expired24h: number;
    capitalSkipped24h: number;
  };
  findings: string[];
}

/**
 * Domain 1 — Acquisition Decision Health Repository
 * Green Tier 1 production rewrite.
 *
 * This health layer explicitly detects the failure that caused the current incident:
 * BUY decisions exist, but capital safety / execution state prevents purchase_queue handoff.
 */
export class AcquisitionDecisionHealthRepository {
  public constructor(private readonly pool: Pool) {}

  public async ping(): Promise<boolean> {
    try {
      await this.pool.query('select 1');
      return true;
    } catch {
      return false;
    }
  }

  public async getLatestHeartbeatAgeSeconds(workerName: string): Promise<number | null> {
    const result = await this.pool.query(
      `
      select extract(epoch from now() - max(last_seen_at))::int as age
      from arb.worker_heartbeats
      where worker_name = $1
      `,
      [workerName],
    );
    return result.rows[0]?.age === null || result.rows[0]?.age === undefined ? null : Number(result.rows[0].age);
  }

  public async countPendingOpportunities(): Promise<number> {
    const result = await this.pool.query(
      `
      select count(*)::int as c
      from arb.opportunity_queue
      where status in ('queued', 'pending', 'retry_needed', 'passed')
         or (status = 'processing' and updated_at < now() - interval '10 minutes')
      `,
    );
    return Number(result.rows[0]?.c ?? 0);
  }

  public async countRecentDeadLetters(): Promise<number> {
    const result = await this.pool.query(
      `
      select
        (
          select count(*)::int
          from arb.dead_letter
          where created_at > now() - interval '1 hour'
            and (worker_name like '%acquisition%' or queue_name in ('opportunity_queue', 'acquisition_decision'))
        ) +
        (
          select count(*)::int
          from arb.prong2_dead_letter
          where created_at > now() - interval '1 hour'
            and worker_name like '%acquisition%'
        ) +
        (
          select count(*)::int
          from arb.comp_dead_letter
          where created_at > now() - interval '1 hour'
        ) as c
      `,
    );
    return Number(result.rows[0]?.c ?? 0);
  }

  public async getHealthSnapshot(workerName = 'acquisition-decision-worker'): Promise<AcquisitionDecisionHealthSnapshot> {
    const dbReachable = await this.ping();
    if (!dbReachable) {
      return {
        ok: false,
        status: 'FAIL',
        checkedAt: new Date().toISOString(),
        metrics: emptyMetrics(false),
        findings: ['DATABASE_UNREACHABLE'],
      };
    }

    const heartbeatAge = await this.getLatestHeartbeatAgeSeconds(workerName);
    const pendingOpportunities = await this.countPendingOpportunities();
    const recentDeadLetters = await this.countRecentDeadLetters();

    const result = await this.pool.query(
      `
      with p as (
        select now() - interval '24 hours' as since_24h
      ),
      decisions_24h as (
        select *
        from arb.decisions d, p
        where d.created_at >= p.since_24h or d.computed_at >= p.since_24h
      ),
      buy_decisions as (
        select *
        from decisions_24h
        where decision::text = 'BUY'
      ),
      decoded as (
        select
          d.*,
          coalesce(d.capital_block_reason_json->>'executionStatus', d.reasons_json->>'executionStatus') as execution_status,
          coalesce(d.capital_block_reason_json->>'purchaseQueueStatus', d.reasons_json->>'purchaseQueueStatus') as purchase_queue_status,
          coalesce(d.capital_block_reason_json->>'status', d.reasons_json->>'capitalStatus') as capital_status
        from buy_decisions d
      )
      select
        (select count(*)::int from decisions_24h) as decisions_24h,
        (select count(*)::int from buy_decisions) as buy_decisions_24h,
        (select count(*)::int from buy_decisions where capital_safe = true) as buy_capital_safe_24h,
        (select count(*)::int from buy_decisions where capital_safe = false) as buy_capital_blocked_24h,
        (select count(*)::int from arb.purchase_queue pq, p where pq.created_at >= p.since_24h) as purchase_queue_24h,
        (select count(*)::int from arb.opportunity_queue oq where oq.status = 'processing' and oq.updated_at < now() - interval '10 minutes') as stale_processing_opportunities,
        (select count(*)::int from decoded where execution_status = 'AUTO_BUY_READY') as auto_buy_ready_24h,
        (select count(*)::int from decoded where execution_status = 'BID_MONITOR_READY') as bid_monitor_ready_24h,
        (select count(*)::int from decoded where execution_status = 'REVIEW_REQUIRED') as review_required_24h,
        (select count(*)::int from decoded where execution_status = 'BLOCKED') as blocked_24h,
        (select count(*)::int from decoded where execution_status = 'EXPIRED') as expired_24h,
        (select count(*)::int from decoded where execution_status = 'CAPITAL_LIMIT_SKIPPED') as capital_skipped_24h,
        (
          select count(*)::int
          from decoded d
          where coalesce(d.purchase_queue_status, '') in ('approved', 'approved_pending_bid_check', 'bid_monitor', 'review_required')
            and not exists (
              select 1
              from arb.listings l
              join arb.listing_normalized ln on ln.listing_external_id = l.listing_external_id
              join arb.purchase_queue pq on pq.source_listing_normalized_id = ln.id
              where l.id = d.listing_id
            )
        ) as purchase_queue_eligible_but_missing_24h
      `,
    );

    const row = result.rows[0] ?? {};
    const metrics = {
      dbReachable,
      latestHeartbeatAgeSeconds: heartbeatAge,
      pendingOpportunities,
      staleProcessingOpportunities: Number(row.stale_processing_opportunities ?? 0),
      recentDeadLetters,
      decisions24h: Number(row.decisions_24h ?? 0),
      buyDecisions24h: Number(row.buy_decisions_24h ?? 0),
      buyCapitalSafe24h: Number(row.buy_capital_safe_24h ?? 0),
      buyCapitalBlocked24h: Number(row.buy_capital_blocked_24h ?? 0),
      purchaseQueue24h: Number(row.purchase_queue_24h ?? 0),
      purchaseQueueEligibleButMissing24h: Number(row.purchase_queue_eligible_but_missing_24h ?? 0),
      autoBuyReady24h: Number(row.auto_buy_ready_24h ?? 0),
      bidMonitorReady24h: Number(row.bid_monitor_ready_24h ?? 0),
      reviewRequired24h: Number(row.review_required_24h ?? 0),
      blocked24h: Number(row.blocked_24h ?? 0),
      expired24h: Number(row.expired_24h ?? 0),
      capitalSkipped24h: Number(row.capital_skipped_24h ?? 0),
    };

    const findings = buildFindings(metrics);
    const status = findings.some((f) => f.startsWith('FAIL_')) ? 'FAIL' : findings.some((f) => f.startsWith('WARN_')) ? 'WARN' : 'PASS';

    return {
      ok: status === 'PASS',
      status,
      checkedAt: new Date().toISOString(),
      metrics,
      findings,
    };
  }
}

function emptyMetrics(dbReachable: boolean): AcquisitionDecisionHealthSnapshot['metrics'] {
  return {
    dbReachable,
    latestHeartbeatAgeSeconds: null,
    pendingOpportunities: 0,
    staleProcessingOpportunities: 0,
    recentDeadLetters: 0,
    decisions24h: 0,
    buyDecisions24h: 0,
    buyCapitalSafe24h: 0,
    buyCapitalBlocked24h: 0,
    purchaseQueue24h: 0,
    purchaseQueueEligibleButMissing24h: 0,
    autoBuyReady24h: 0,
    bidMonitorReady24h: 0,
    reviewRequired24h: 0,
    blocked24h: 0,
    expired24h: 0,
    capitalSkipped24h: 0,
  };
}

function buildFindings(metrics: AcquisitionDecisionHealthSnapshot['metrics']): string[] {
  const findings: string[] = [];

  if (!metrics.dbReachable) findings.push('FAIL_DATABASE_UNREACHABLE');
  if (metrics.latestHeartbeatAgeSeconds === null) findings.push('WARN_NO_ACQUISITION_HEARTBEAT');
  else if (metrics.latestHeartbeatAgeSeconds > 600) findings.push('FAIL_ACQUISITION_HEARTBEAT_STALE');

  if (metrics.pendingOpportunities > 0 && metrics.decisions24h === 0) findings.push('FAIL_OPPORTUNITIES_EXIST_BUT_NO_DECISIONS_24H');
  if (metrics.buyDecisions24h > 0 && metrics.purchaseQueue24h === 0) findings.push('FAIL_BUY_DECISIONS_EXIST_BUT_NO_PURCHASE_QUEUE_24H');
  if (metrics.purchaseQueueEligibleButMissing24h > 0) findings.push('FAIL_PURCHASE_QUEUE_ELIGIBLE_BUYS_MISSING_QUEUE_ROWS');
  if (metrics.buyDecisions24h > 0 && metrics.buyCapitalSafe24h === 0 && metrics.reviewRequired24h === 0 && metrics.bidMonitorReady24h === 0) findings.push('WARN_ALL_BUYS_ARE_BLOCKED_OR_UNCLASSIFIED');
  if (metrics.staleProcessingOpportunities > 0) findings.push('WARN_STALE_PROCESSING_OPPORTUNITIES');
  if (metrics.recentDeadLetters > 0) findings.push('WARN_RECENT_DEAD_LETTERS');
  if (metrics.decisions24h === 0 && metrics.pendingOpportunities === 0) findings.push('WARN_NO_DECISION_ACTIVITY_AND_NO_PENDING_WORK');

  if (findings.length === 0) findings.push('PASS_DOMAIN1_DECISION_PIPELINE_HEALTHY');
  return findings;
}
