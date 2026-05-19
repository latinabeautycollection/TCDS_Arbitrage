import { Pool } from 'pg';

const config = {
  workerName: process.env.PROFIT_DRAINER_NAME ?? 'profit-decision-drainer',
  pollIntervalMs: parseInt(process.env.PROFIT_DRAINER_POLL_MS ?? '5000', 10),
  emptyPollMs: parseInt(process.env.PROFIT_DRAINER_EMPTY_POLL_MS ?? '15000', 10),
  batchSize: parseInt(process.env.PROFIT_DRAINER_BATCH ?? '25', 10),
  feeRate: parseFloat(process.env.ARB_FEE_RATE ?? '0.135'),
  paymentProcessingRate: parseFloat(process.env.ARB_PAYMENT_PROCESSING_RATE ?? '0.03'),
  reserveRate: parseFloat(process.env.ARB_RESERVE_RATE ?? '0.03'),
  packagingCostUsd: parseFloat(process.env.ARB_PACKAGING_COST_USD ?? '2.00'),
  ruleVersion: process.env.PROFIT_RULE_VERSION ?? 'v1',
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface DrainableRow {
  oq_id: number;
  candidate_id: number;
  watchlist_id: number | null;
  match_score: string | null;
  priority_score: string | null;
  listing_uuid: string;
  current_price: string | null;
  inbound_shipping_usd: string | null;
  comp_result_json: Record<string, unknown>;
}

function log(level: 'info' | 'warn' | 'error', msg: string, meta: Record<string, unknown> = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    component: config.workerName,
    ...meta,
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

async function processBatch(pool: Pool): Promise<{ claimed: number; written: number; skipped: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
        await client.query('BEGIN');

    // Expire any queued items whose underlying auction has ended.
    // Defense-in-depth in case a producer slips a stale item through.
    await client.query(`
      update arb.opportunity_queue oq
      set status = 'expired',
          phase_summary_current = 'auction_ended_before_decision',
          updated_at = now()
      from arb.candidates c
      join arb.listings l on l.id = c.listing_id
      where oq.candidate_id = c.id
        and oq.status = 'queued'
        and l.end_time < now();
    `);

    const { rows } = await client.query<DrainableRow>(
      `
      select
        oq.id as oq_id,
        oq.candidate_id,
        oq.watchlist_id,
        oq.match_score,
        oq.priority_score,
        c.listing_id as listing_uuid,
        c.current_price,
        c.inbound_shipping_usd,
        l.comp_result_json
      from arb.opportunity_queue oq
      join arb.candidates c on c.id = oq.candidate_id
      join arb.listings l on l.id = c.listing_id
where oq.status = 'queued'
  and l.comp_status = 'completed'
  and (l.comp_result_json -> 'expectedResaleUsd') is not null
  and (l.end_time is null or l.end_time > now())
      order by oq.priority_score desc nulls last, oq.id asc
      limit $1
      for update of oq skip locked
      `,
      [config.batchSize]
    );

    if (rows.length === 0) {
      await client.query('COMMIT');
      return { claimed: 0, written: 0, skipped: 0 };
    }

    let written = 0;
    let skipped = 0;

    for (const row of rows) {
      const compJson = row.comp_result_json ?? {};
      const expectedResale = Number(compJson.expectedResaleUsd ?? 0);
      const decision = String(compJson.decision ?? 'REJECT').toUpperCase();
      const compCount = Number(compJson.acceptedSoldCompCount ?? compJson.activeCompCount ?? 0);
      const pricingMethod = String(compJson.pricingMethod ?? 'unknown');
      const confidence = decision === 'BUY' ? 0.85 : decision === 'WATCH' ? 0.55 : 0.25;

      const propertyRoomPrice = Number(row.current_price ?? 0);
      const propertyRoomShipping = Number(row.inbound_shipping_usd ?? 0);

      if (expectedResale <= 0) {
        await client.query(
          `update arb.opportunity_queue set status='passed', phase_summary_current=$2, updated_at=now() where id=$1`,
          [row.oq_id, 'no_pricing_signal']
        );
        skipped++;
        continue;
      }

      const grossRevenue = expectedResale;
      const ebayFee = expectedResale * config.feeRate;
      const paymentFee = expectedResale * config.paymentProcessingRate;
      const otherCosts = expectedResale * config.reserveRate;
      const totalCost =
        propertyRoomPrice + propertyRoomShipping +
        ebayFee + paymentFee + config.packagingCostUsd + otherCosts;
      const netProfit = grossRevenue - totalCost;
      const roi = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;
      const margin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

      await client.query(
        `
        insert into arb.profit_decision (
          listing_id, decision_status, confidence_score, comp_count,
          estimated_resale_price, estimated_shipping_to_buyer, estimated_gross_revenue,
          propertyroom_price, propertyroom_shipping, estimated_sales_tax,
          estimated_ebay_fee, estimated_payment_fee, estimated_packaging_cost,
          estimated_other_costs, estimated_total_cost, estimated_net_profit,
          estimated_roi_percent, estimated_margin_percent,
          rule_version, rule_reason, decision_json
        ) values (
          $1, $2, $3, $4,
          $5, $6, $7,
          $8, $9, $10,
          $11, $12, $13,
          $14, $15, $16,
          $17, $18,
          $19, $20, $21::jsonb
        )
        `,
        [
          row.candidate_id,
          decision,
          confidence,
          compCount,
          round2(expectedResale),
          0,
          round2(grossRevenue),
          round2(propertyRoomPrice),
          round2(propertyRoomShipping),
          0,
          round2(ebayFee),
          round2(paymentFee),
          round2(config.packagingCostUsd),
          round2(otherCosts),
          round2(totalCost),
          round2(netProfit),
          round2(roi),
          round2(margin),
          config.ruleVersion,
          `pricing=${pricingMethod}; decision=${decision}; comps=${compCount}`,
          JSON.stringify({
            opportunityQueueId: row.oq_id,
            listingUuid: row.listing_uuid,
            watchlistId: row.watchlist_id,
            matchScore: row.match_score ? Number(row.match_score) : null,
            priorityScore: row.priority_score ? Number(row.priority_score) : null,
            pricingMethod,
            sourceCompResult: compJson,
          }),
        ]
      );

      const newStatus = decision === 'BUY' || decision === 'WATCH' ? 'reviewed' : 'passed';
      await client.query(
        `update arb.opportunity_queue
            set status=$2, phase_summary_current=$3, updated_at=now()
          where id=$1`,
        [row.oq_id, newStatus, `profit_decision:${decision}:net=$${round2(netProfit)}`]
      );

      written++;
    }

    await client.query('COMMIT');
    return { claimed: rows.length, written, skipped };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    log('error', 'DATABASE_URL missing');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: url,
    max: 5,
    ssl: { rejectUnauthorized: false },
  });
  let running = true;
  const shutdown = (signal: string) => {
    log('warn', 'shutdown signal', { signal });
    running = false;
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  log('info', 'starting', { config });

  while (running) {
    try {
      const result = await processBatch(pool);
      if (result.claimed > 0) {
        log('info', 'batch processed', result);
      }
      await sleep(result.claimed === 0 ? config.emptyPollMs : config.pollIntervalMs);
    } catch (err) {
      log('error', 'batch failed', { error: (err as Error).message });
      await sleep(config.pollIntervalMs * 2);
    }
  }

  await pool.end();
  log('info', 'stopped');
  process.exit(0);
}

main().catch(err => {
  log('error', 'fatal', { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
