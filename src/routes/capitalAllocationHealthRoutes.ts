/* src/routes/capitalAllocationHealthRoutes.ts
 * Domain 2 — Capital Allocation Health Routes
 * Adds hardened visibility for BUY → allocation → purchase queue handoff.
 */

import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';

type HealthStatus = 'healthy' | 'degraded' | 'not_ready';

interface RouteConfig {
  pool: Pool;
  serviceName?: string;
  readinessFreshMinutes?: number;
}

const ALLOCATABLE_EXECUTION_STATUSES = ['AUTO_BUY_READY', 'BID_MONITOR_READY', 'REVIEW_REQUIRED'];

export function createCapitalAllocationHealthRouter(input: RouteConfig): Router {
  const router = Router();

  const serviceName = input.serviceName || 'capital-allocation-engine';
  const readinessFreshMinutes = input.readinessFreshMinutes ?? 30;

  router.get('/health', async (_req: Request, res: Response) => {
    try {
      await input.pool.query('select 1');

      return res.status(200).json({
        ok: true,
        status: 'healthy' satisfies HealthStatus,
        service: serviceName,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(503).json({
        ok: false,
        status: 'degraded' satisfies HealthStatus,
        service: serviceName,
        timestamp: new Date().toISOString(),
        error: serializeRouteError(error),
      });
    }
  });

  router.get('/ready', async (_req: Request, res: Response) => {
    try {
      await assertRequiredObjects(input.pool);

      const handoff = await getHandoffSummary(input.pool, readinessFreshMinutes);
      const policy = await getPolicySummary(input.pool);

      const ready =
        Boolean(policy?.enabled) &&
        Number(handoff.buy_decisions_24h) >= 0 &&
        Number(handoff.domain2_source_allocatable_24h) >= 0;

      return res.status(ready ? 200 : 503).json({
        ok: ready,
        status: ready ? 'healthy' : 'not_ready',
        service: serviceName,
        timestamp: new Date().toISOString(),
        readinessFreshMinutes,
        policy,
        handoff,
      });
    } catch (error) {
      return res.status(503).json({
        ok: false,
        status: 'degraded',
        service: serviceName,
        timestamp: new Date().toISOString(),
        error: serializeRouteError(error),
      });
    }
  });

  router.get('/handoff', async (_req: Request, res: Response) => {
    try {
      await assertRequiredObjects(input.pool);
      const handoff = await getHandoffSummary(input.pool, readinessFreshMinutes);

      const ok = Number(handoff.buy_decisions_24h) === 0 || Number(handoff.domain2_source_allocatable_24h) > 0 || Number(handoff.blocked_execution_24h) > 0;
      return res.status(ok ? 200 : 503).json({
        ok,
        service: serviceName,
        timestamp: new Date().toISOString(),
        handoff,
      });
    } catch (error) {
      return res.status(503).json({
        ok: false,
        service: serviceName,
        timestamp: new Date().toISOString(),
        error: serializeRouteError(error),
      });
    }
  });

  router.get('/blocked-buys', async (_req: Request, res: Response) => {
    try {
      await assertRequiredObjects(input.pool);

      const result = await input.pool.query(`
        select
          d.id,
          d.listing_id,
          d.decision::text as decision,
          coalesce(d.execution_status::text,
            case
              when coalesce(d.capital_safe, false) is true then 'AUTO_BUY_READY'
              when d.decision::text ilike 'BUY%' then 'REVIEW_REQUIRED'
              else 'BLOCKED'
            end
          ) as execution_status,
          coalesce(d.capital_safety_status::text,
            case when coalesce(d.capital_safe, false) is true then 'PASS' else 'REVIEW_REQUIRED' end
          ) as capital_safety_status,
          coalesce(d.purchase_queue_status::text, 'not_queued') as purchase_queue_status,
          d.capital_safe,
          d.capital_block_reason_json,
          coalesce(d.hard_block_reasons, array[]::text[]) as hard_block_reasons,
          coalesce(d.soft_review_reasons, array[]::text[]) as soft_review_reasons,
          coalesce(d.estimated_profit_usd, d.expected_profit_usd, 0) as profit_usd,
          coalesce(d.estimated_roi, d.expected_roi, 0) as roi,
          d.created_at
        from arb.decisions d
        where d.decision::text ilike 'BUY%'
          and coalesce(d.execution_status::text, '') in ('BLOCKED','EXPIRED','CAPITAL_LIMIT_SKIPPED')
        order by d.created_at desc
        limit 100
      `);

      return res.status(200).json({
        ok: true,
        service: serviceName,
        timestamp: new Date().toISOString(),
        blockedBuys: result.rows,
      });
    } catch (error) {
      return res.status(503).json({
        ok: false,
        service: serviceName,
        timestamp: new Date().toISOString(),
        error: serializeRouteError(error),
      });
    }
  });

  router.get('/latest', async (_req: Request, res: Response) => {
    try {
      await assertRequiredObjects(input.pool);

      const result = await input.pool.query(`
        select *
        from arb.v_capital_allocation_latest
        limit 1
      `).catch(async () => input.pool.query(`
        select *
        from arb.capital_allocation_runs
        order by completed_at desc nulls last, id desc
        limit 1
      `));

      return res.status(200).json({
        ok: true,
        service: serviceName,
        timestamp: new Date().toISOString(),
        latestRun: result.rows[0] ?? null,
      });
    } catch (error) {
      return res.status(503).json({
        ok: false,
        service: serviceName,
        timestamp: new Date().toISOString(),
        error: serializeRouteError(error),
      });
    }
  });

  router.get('/source/summary', async (_req: Request, res: Response) => {
    try {
      await assertRequiredObjects(input.pool);

      const result = await input.pool.query(`
        select
          count(*)::int as total_rows,
          count(*) filter (where qualification_status = 'BUY_QUALIFIED')::int as buy_qualified_rows,
          count(*) filter (
            where qualification_status = 'BUY_QUALIFIED'
              and coalesce(execution_status, 'REVIEW_REQUIRED') = any($1::text[])
              and coalesce(required_capital_usd, effective_cost_basis_usd, expected_total_cost_basis_usd, 0) > 0
              and coalesce(expected_profit_usd, estimated_profit_usd, 0) > 0
          )::int as allocatable_rows,
          count(*) filter (where coalesce(execution_status, '') in ('BLOCKED','EXPIRED','CAPITAL_LIMIT_SKIPPED'))::int as blocked_rows,
          max(created_at) as latest_source_at
        from arb.v_domain2_buy_qualified_source
      `, [ALLOCATABLE_EXECUTION_STATUSES]);

      return res.status(200).json({
        ok: true,
        service: serviceName,
        timestamp: new Date().toISOString(),
        sourceSummary: result.rows[0],
      });
    } catch (error) {
      return res.status(503).json({
        ok: false,
        service: serviceName,
        timestamp: new Date().toISOString(),
        error: serializeRouteError(error),
      });
    }
  });

  router.get('/dead-letters', async (_req: Request, res: Response) => {
    try {
      await assertRequiredObjects(input.pool);

      const result = await input.pool.query(`
        select
          count(*) filter (where created_at >= now() - interval '24 hours')::int as dead_letters_24h,
          max(created_at) as latest_dead_letter_at
        from arb.capital_allocation_dead_letter
      `);

      const row = result.rows[0];

      return res.status(Number(row?.dead_letters_24h ?? 0) === 0 ? 200 : 503).json({
        ok: Number(row?.dead_letters_24h ?? 0) === 0,
        service: serviceName,
        timestamp: new Date().toISOString(),
        deadLetters: row,
      });
    } catch (error) {
      return res.status(503).json({
        ok: false,
        service: serviceName,
        timestamp: new Date().toISOString(),
        error: serializeRouteError(error),
      });
    }
  });

  router.get('/policy', async (_req: Request, res: Response) => {
    try {
      await assertRequiredObjects(input.pool);
      const policy = await getPolicySummary(input.pool);

      return res.status(policy?.enabled ? 200 : 503).json({
        ok: Boolean(policy?.enabled),
        service: serviceName,
        timestamp: new Date().toISOString(),
        policy,
      });
    } catch (error) {
      return res.status(503).json({
        ok: false,
        service: serviceName,
        timestamp: new Date().toISOString(),
        error: serializeRouteError(error),
      });
    }
  });

  return router;
}

async function getHandoffSummary(pool: Pool, readinessFreshMinutes: number): Promise<Record<string, number | string | null>> {
  const result = await pool.query(`
    with d as (
      select
        id,
        decision::text as decision,
        coalesce(execution_status::text,
          case
            when coalesce(capital_safe, false) is true then 'AUTO_BUY_READY'
            when decision::text ilike 'BUY%' then 'REVIEW_REQUIRED'
            else 'BLOCKED'
          end
        ) as execution_status,
        created_at
      from arb.decisions
      where created_at >= now() - ($1::int || ' minutes')::interval
    ),
    src as (
      select *
      from arb.v_domain2_buy_qualified_source
      where created_at >= now() - ($1::int || ' minutes')::interval
    ),
    latest_run as (
      select *
      from arb.capital_allocation_runs
      order by completed_at desc nulls last, id desc
      limit 1
    )
    select
      (select count(*)::int from d where decision ilike 'BUY%') as buy_decisions_24h,
      (select count(*)::int from d where decision ilike 'BUY%' and execution_status in ('AUTO_BUY_READY','BID_MONITOR_READY','REVIEW_REQUIRED')) as allocatable_execution_24h,
      (select count(*)::int from d where decision ilike 'BUY%' and execution_status in ('BLOCKED','EXPIRED','CAPITAL_LIMIT_SKIPPED')) as blocked_execution_24h,
      (select count(*)::int from src where qualification_status = 'BUY_QUALIFIED') as domain2_source_buy_qualified_24h,
      (select count(*)::int from src where qualification_status = 'BUY_QUALIFIED' and coalesce(execution_status, 'REVIEW_REQUIRED') in ('AUTO_BUY_READY','BID_MONITOR_READY','REVIEW_REQUIRED')) as domain2_source_allocatable_24h,
      coalesce((select allocated_count::int from latest_run), 0) as latest_allocated_count,
      coalesce((select allocated_capital_usd::text from latest_run), '0') as latest_allocated_capital_usd,
      (select completed_at::text from latest_run) as latest_completed_at
  `, [readinessFreshMinutes]);

  return result.rows[0] ?? {};
}

async function getPolicySummary(pool: Pool): Promise<Record<string, unknown> | null> {
  const result = await pool.query(`
    select
      id,
      policy_version,
      mode,
      total_capital_usd,
      reserve_pct,
      max_per_item_usd,
      max_category_exposure_pct,
      max_family_exposure_pct,
      min_buy_a_plus_score,
      min_buy_a_score,
      min_buy_b_score,
      min_confidence_score,
      require_capital_safety,
      require_liveness,
      require_valid_cost_basis,
      enabled,
      updated_by,
      updated_at
    from arb.capital_allocation_policy
    where id = 1
  `);

  return result.rows[0] ?? null;
}

async function assertRequiredObjects(pool: Pool): Promise<void> {
  await pool.query(`
    do $$
    begin
      if to_regclass('arb.capital_allocation_policy') is null then raise exception 'missing table arb.capital_allocation_policy'; end if;
      if to_regclass('arb.capital_allocation_runs') is null then raise exception 'missing table arb.capital_allocation_runs'; end if;
      if to_regclass('arb.capital_allocation_items') is null then raise exception 'missing table arb.capital_allocation_items'; end if;
      if to_regclass('arb.capital_allocation_dead_letter') is null then raise exception 'missing table arb.capital_allocation_dead_letter'; end if;
      if to_regclass('arb.v_domain2_buy_qualified_source') is null then raise exception 'missing view arb.v_domain2_buy_qualified_source'; end if;
      if to_regclass('arb.worker_heartbeats') is null then raise exception 'missing table arb.worker_heartbeats'; end if;
      if to_regclass('arb.decisions') is null then raise exception 'missing table arb.decisions'; end if;
    end $$;
  `);
}

function serializeRouteError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
    };
  }

  return { name: 'UnknownError', message: String(error) };
}
