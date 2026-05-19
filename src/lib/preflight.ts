import { pool } from '../db/pool';
import { redisConnection, createQueue } from '../queues/bullmq';

export type PreflightSeverity = 'CRITICAL' | 'WARN' | 'INFO';

export type PreflightCheckResult = {
  name: string;
  severity: PreflightSeverity;
  ok: boolean;
  detail: string;
  meta?: Record<string, unknown>;
};

export type PreflightSummary = {
  totalChecks: number;
  passed: number;
  failed: number;
  warnings: number;
  criticalFailures: number;
};

export type ThresholdConfig = {
  staleCandidateClaimMinutes: number;
  staleMarketClaimMinutes: number;
  staleJobLockMinutes: number;
  staleProcessStepClaimMinutes: number;
  staleWorkerHeartbeatMinutes: number;
  recentFailedRunHours: number;
};

export type PreflightReport = {
  results: PreflightCheckResult[];
  summary: PreflightSummary;
};

const thresholds: ThresholdConfig = {
  staleCandidateClaimMinutes: 15,
  staleMarketClaimMinutes: 15,
  staleJobLockMinutes: 15,
  staleProcessStepClaimMinutes: 15,
  staleWorkerHeartbeatMinutes: 5,
  recentFailedRunHours: 24
};

export const REQUIRED_TABLES = [
  'arb.process_registry',
  'arb.process_runs',
  'arb.worker_heartbeats',
  'arb.db_mutation_ledger',
  'arb.service_call_ledger',
  'arb.entity_claim_ledger',
  'arb.product_journal',
  'arb.phase_summary_events',
  'arb.listings',
  'arb.candidates',
  'arb.opportunity_queue',
  'arb.market_intel_runs',
  'arb.ebay_market_snapshots',
  'arb.shipment_quotes',
  'arb.shipments',
  'arb.decisions',
  'arb.profit_analysis',
  'arb.source_price_history',
  'arb.comp_price_history',
  'arb.process_steps',
  'arb.forensic_events',
  'arb.listing_evidence',
  'arb.shipping_evidence',
  'arb.pricing_evidence',
  'arb.learning_features',
  'arb.dead_letter',
  'arb.queue_idempotency',
  'arb.replay_requests'
] as const;

export const REQUIRED_COLUMNS: Array<{
  table: string;
  columns: string[];
}> = [
  {
    table: 'arb.process_runs',
    columns: [
      'run_id',
      'process_name',
      'status',
      'correlation_id',
      'actor_type',
      'actor_id',
      'actor_name',
      'worker_name',
      'worker_instance_id',
      'entity_type',
      'started_at',
      'completed_at',
      'failed_at',
      'details_json',
      'idempotency_key'
    ]
  },
  {
    table: 'arb.process_steps',
    columns: [
      'id',
      'process_run_id',
      'step_name',
      'queue_name',
      'entity_type',
      'entity_pk',
      'status',
      'attempt_no',
      'job_id',
      'idempotency_key',
      'claim_token',
      'claimed_at',
      'claimed_by',
      'claim_expires_at',
      'payload_json',
      'result_json'
    ]
  },
  {
    table: 'arb.forensic_events',
    columns: [
      'id',
      'process_run_id',
      'process_step_id',
      'entity_type',
      'entity_pk',
      'event_type',
      'action_type',
      'actor_type',
      'actor_id',
      'worker_name',
      'worker_instance_id',
      'queue_name',
      'job_id',
      'idempotency_key',
      'before_json',
      'after_json',
      'diff_json',
      'evidence_json',
      'metrics_json',
      'flags_json',
      'prev_hash',
      'event_hash',
      'event_at'
    ]
  },
  {
    table: 'arb.listing_evidence',
    columns: [
      'id',
      'process_run_id',
      'process_step_id',
      'forensic_event_id',
      'listing_id',
      'source_listing_normalized_id',
      'candidate_id',
      'source_platform',
      'source_external_id',
      'title',
      'normalized_title',
      'brand',
      'model',
      'category_key',
      'condition_text',
      'current_price',
      'buy_now_price',
      'inbound_shipping_usd',
      'total_cost',
      'payload_json'
    ]
  },
  {
    table: 'arb.shipping_evidence',
    columns: [
      'id',
      'process_run_id',
      'process_step_id',
      'forensic_event_id',
      'entity_type',
      'entity_pk',
      'source_listing_normalized_id',
      'shipment_id',
      'carrier_code',
      'service_code',
      'service_name',
      'quoted_label_cost_usd',
      'estimated_delivery_days',
      'on_time_probability',
      'tracking_quality_score',
      'claim_risk_score',
      'payload_json'
    ]
  },
  {
    table: 'arb.pricing_evidence',
    columns: [
      'id',
      'process_run_id',
      'process_step_id',
      'forensic_event_id',
      'entity_type',
      'entity_pk',
      'source_listing_normalized_id',
      'candidate_id',
      'decision_id',
      'price_type',
      'amount_usd',
      'ebay_fee_usd',
      'payment_fee_usd',
      'shipping_usd',
      'total_cost_basis_usd',
      'expected_profit_usd',
      'roi_pct',
      'margin_pct',
      'payload_json'
    ]
  },
  {
    table: 'arb.learning_features',
    columns: [
      'id',
      'process_run_id',
      'forensic_event_id',
      'entity_type',
      'entity_pk',
      'feature_group',
      'feature_name',
      'feature_value_json'
    ]
  },
  {
    table: 'arb.dead_letter',
    columns: [
      'id',
      'process_run_id',
      'process_step_id',
      'queue_name',
      'job_id',
      'entity_type',
      'entity_pk',
      'worker_name',
      'worker_instance_id',
      'error_code',
      'error_message',
      'payload_json',
      'retry_count'
    ]
  },
  {
    table: 'arb.queue_idempotency',
    columns: [
      'id',
      'queue_name',
      'idempotency_key',
      'job_id',
      'process_run_id',
      'entity_type',
      'entity_pk',
      'payload_hash'
    ]
  },
  {
    table: 'arb.candidates',
    columns: [
      'id',
      'listing_id',
      'status',
      'claim_token',
      'claimed_at',
      'claimed_by',
      'claim_expires_at',
      'process_attempts',
      'process_last_error',
      'matched_watchlist_id',
      'best_watchlist_id',
      'best_match_score',
      'phase_summary_current',
      'last_process_name',
      'last_process_stage',
      'last_process_run_id'
    ]
  },
  {
    table: 'arb.listings',
    columns: [
      'id',
      'listing_external_id',
      'platform',
      'status',
      'title',
      'condition_text',
      'current_price',
      'buy_now_price',
      'inbound_shipping_usd',
      'payload_json',
      'phase_summary_current',
      'last_process_name',
      'last_process_stage',
      'last_process_run_id'
    ]
  },
  {
    table: 'arb.opportunity_queue',
    columns: [
      'id',
      'candidate_id',
      'watchlist_id',
      'match_score',
      'priority_score',
      'status',
      'reason_json',
      'process_name',
      'process_run_id',
      'actor_type',
      'actor_id',
      'actor_name',
      'queued_at',
      'phase_summary_current'
    ]
  },
  {
    table: 'arb.market_intel_runs',
    columns: [
      'id',
      'strategy_id',
      'status',
      'api_source',
      'metric_name',
      'requested_product_count',
      'received_product_count',
      'correlation_id',
      'error_code',
      'error_message',
      'process_run_id',
      'actor_type',
      'actor_id',
      'actor_name'
    ]
  },
  {
    table: 'arb.ebay_market_snapshots',
    columns: [
      'id',
      'run_id',
      'strategy_id',
      'category_key',
      'metric_name',
      'query_context_json',
      'item_count',
      'avg_price_usd',
      'median_price_usd',
      'raw_payload_json',
      'process_run_id',
      'actor_type',
      'actor_id',
      'actor_name'
    ]
  }
];

export const REQUIRED_INDEXES = [
  'uq_process_runs_process_name_idempotency',
  'uq_jobs_type_idempotency',
  'uq_job_queue_type_idempotency',
  'idx_process_steps_run_status',
  'idx_process_steps_queue_status',
  'idx_forensic_events_run',
  'idx_forensic_events_entity',
  'idx_forensic_events_queue_job',
  'idx_listing_evidence_listing',
  'idx_listing_evidence_candidate',
  'idx_shipping_evidence_entity',
  'idx_pricing_evidence_entity',
  'idx_learning_features_entity',
  'idx_dead_letter_queue_created',
  'idx_replay_requests_status'
] as const;

export const REQUIRED_PROCESSES = [
  'forensic.capture_listing',
  'forensic.capture_shipping',
  'forensic.capture_pricing',
  'forensic.compute_learning',
  'forensic.finalize_run',
  'forensic.candidate_opportunity',
  'forensic.market_intel'
] as const;

export const REQUIRED_QUEUE_NAMES = [
  'forensic.capture.listing',
  'forensic.capture.shipping',
  'forensic.capture.pricing',
  'forensic.compute.learning',
  'forensic.finalize.run'
] as const;

function splitTableName(qualifiedTableName: string): { schema: string; table: string } {
  const parts = qualifiedTableName.split('.');
  return { schema: parts[0] ?? '', table: parts[1] ?? '' };
}

async function tableExists(qualifiedTableName: string): Promise<boolean> {
  const { schema, table } = splitTableName(qualifiedTableName);
  const res = await pool.query(
    `
    select exists (
      select 1
      from information_schema.tables
      where table_schema = $1
        and table_name = $2
    ) as exists
    `,
    [schema, table]
  );
  return Boolean(res.rows[0]?.exists);
}

async function columnExists(qualifiedTableName: string, columnName: string): Promise<boolean> {
  const { schema, table } = splitTableName(qualifiedTableName);
  const res = await pool.query(
    `
    select exists (
      select 1
      from information_schema.columns
      where table_schema = $1
        and table_name = $2
        and column_name = $3
    ) as exists
    `,
    [schema, table, columnName]
  );
  return Boolean(res.rows[0]?.exists);
}

async function indexExists(indexName: string): Promise<boolean> {
  const res = await pool.query(
    `
    select exists (
      select 1
      from pg_indexes
      where schemaname = 'arb'
        and indexname = $1
    ) as exists
    `,
    [indexName]
  );
  return Boolean(res.rows[0]?.exists);
}

async function checkDbConnectivity(): Promise<PreflightCheckResult> {
  const start = Date.now();
  await pool.query('select 1 as ok');
  return {
    name: 'database.connectivity',
    severity: 'CRITICAL',
    ok: true,
    detail: `Postgres reachable in ${Date.now() - start}ms`
  };
}

async function checkRedisConnectivity(): Promise<PreflightCheckResult> {
  const start = Date.now();
  const pong = await redisConnection.ping();
  return {
    name: 'redis.connectivity',
    severity: 'CRITICAL',
    ok: pong === 'PONG',
    detail: pong === 'PONG'
      ? `Redis reachable in ${Date.now() - start}ms`
      : `Unexpected Redis ping response: ${pong}`
  };
}

async function checkMigrationHistory(): Promise<PreflightCheckResult> {
  const exists = await tableExists('arb.schema_migration');
  if (!exists) {
    return {
      name: 'schema.migration_history',
      severity: 'CRITICAL',
      ok: false,
      detail: 'arb.schema_migration is missing'
    };
  }

  const res = await pool.query(`select count(*)::int as count from arb.schema_migration`);
  return {
    name: 'schema.migration_history',
    severity: 'CRITICAL',
    ok: res.rows[0].count > 0,
    detail: `Applied migrations: ${res.rows[0].count}`,
    meta: { appliedMigrations: res.rows[0].count }
  };
}

async function checkRequiredTables(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];
  for (const table of REQUIRED_TABLES) {
    const exists = await tableExists(table);
    results.push({
      name: `schema.table.${table}`,
      severity: 'CRITICAL',
      ok: exists,
      detail: exists ? 'Present' : 'Missing'
    });
  }
  return results;
}

async function checkRequiredColumns(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];
  for (const requirement of REQUIRED_COLUMNS) {
    for (const column of requirement.columns) {
      const exists = await columnExists(requirement.table, column);
      results.push({
        name: `schema.column.${requirement.table}.${column}`,
        severity: 'CRITICAL',
        ok: exists,
        detail: exists ? 'Present' : 'Missing'
      });
    }
  }
  return results;
}

async function checkRequiredIndexes(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];
  for (const indexName of REQUIRED_INDEXES) {
    const exists = await indexExists(indexName);
    results.push({
      name: `schema.index.${indexName}`,
      severity: 'CRITICAL',
      ok: exists,
      detail: exists ? 'Present' : 'Missing'
    });
  }
  return results;
}

async function checkProcessRegistry(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];
  for (const processName of REQUIRED_PROCESSES) {
    const res = await pool.query(
      `
      select phase_no, process_group, active_flag
      from arb.process_registry
      where process_name = $1
      `,
      [processName]
    );
    const row = res.rows[0];
    results.push({
      name: `process_registry.${processName}`,
      severity: 'CRITICAL',
      ok: Boolean(row),
      detail: row
        ? `Present. phase_no=${row.phase_no}, group=${row.process_group}, active=${row.active_flag}`
        : 'Missing process_registry row'
    });
  }
  return results;
}

async function checkQueueHealth(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  for (const queueName of REQUIRED_QUEUE_NAMES) {
    const queue = createQueue(queueName);
    try {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'paused',
        'waiting-children'
      );

      const backlog = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
      const failed = counts.failed ?? 0;

      results.push({
        name: `queue.health.${queueName}`,
        severity: failed > 0 ? 'WARN' : 'CRITICAL',
        ok: true,
        detail: `Queue reachable. waiting=${counts.waiting ?? 0}, active=${counts.active ?? 0}, delayed=${counts.delayed ?? 0}, failed=${failed}, completed=${counts.completed ?? 0}`,
        meta: {
          backlog,
          failed,
          counts
        }
      });
    } catch (error: any) {
      results.push({
        name: `queue.health.${queueName}`,
        severity: 'CRITICAL',
        ok: false,
        detail: `Queue check failed: ${error.message}`
      });
    } finally {
      await queue.close();
    }
  }

  return results;
}

async function checkWorkerHeartbeats(): Promise<PreflightCheckResult> {
  const res = await pool.query(
    `
    select count(*)::int as stale_count
    from arb.worker_heartbeats
    where coalesce(updated_at, last_seen_at) < now() - make_interval(mins => $1)
       or status is null
    `,
    [thresholds.staleWorkerHeartbeatMinutes]
  );

  const total = await pool.query(`select count(*)::int as total_count from arb.worker_heartbeats`);

  const staleCount = res.rows[0].stale_count as number;
  const totalCount = total.rows[0].total_count as number;

  return {
    name: 'workers.heartbeats',
    severity: staleCount > 0 ? 'WARN' : 'CRITICAL',
    ok: totalCount > 0 && staleCount === 0,
    detail: `worker_heartbeats total=${totalCount}, stale=${staleCount}, threshold=${thresholds.staleWorkerHeartbeatMinutes}m`,
    meta: { totalCount, staleCount }
  };
}

async function checkStaleCandidateClaims(): Promise<PreflightCheckResult> {
  const res = await pool.query(
    `
    select count(*)::int as stale_count
    from arb.candidates
    where claim_token is not null
      and claim_expires_at is not null
      and claim_expires_at < now() - make_interval(mins => $1)
    `,
    [thresholds.staleCandidateClaimMinutes]
  );

  const staleCount = res.rows[0].stale_count as number;

  return {
    name: 'locks.candidates',
    severity: staleCount > 0 ? 'WARN' : 'CRITICAL',
    ok: staleCount === 0,
    detail: `Stale candidate claims=${staleCount}`,
    meta: { staleCount }
  };
}

async function checkStaleMarketClaims(): Promise<PreflightCheckResult> {
  const res = await pool.query(
    `
    select count(*)::int as stale_count
    from arb.market_snapshot_products
    where claim_token is not null
      and claim_expires_at is not null
      and claim_expires_at < now() - make_interval(mins => $1)
    `,
    [thresholds.staleMarketClaimMinutes]
  );

  const staleCount = res.rows[0].stale_count as number;

  return {
    name: 'locks.market_snapshot_products',
    severity: staleCount > 0 ? 'WARN' : 'CRITICAL',
    ok: staleCount === 0,
    detail: `Stale market snapshot claims=${staleCount}`,
    meta: { staleCount }
  };
}

async function checkStaleProcessStepClaims(): Promise<PreflightCheckResult> {
  const res = await pool.query(
    `
    select count(*)::int as stale_count
    from arb.process_steps
    where claim_token is not null
      and claim_expires_at is not null
      and claim_expires_at < now() - make_interval(mins => $1)
      and status = 'RUNNING'
    `,
    [thresholds.staleProcessStepClaimMinutes]
  );

  const staleCount = res.rows[0].stale_count as number;

  return {
    name: 'locks.process_steps',
    severity: staleCount > 0 ? 'WARN' : 'CRITICAL',
    ok: staleCount === 0,
    detail: `Stale process step claims=${staleCount}`,
    meta: { staleCount }
  };
}

async function checkStaleJobLocks(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  const jobsRes = await pool.query(
    `
    select count(*)::int as stale_count
    from arb.jobs
    where locked_at is not null
      and locked_at < now() - make_interval(mins => $1)
      and status = 'running'
    `,
    [thresholds.staleJobLockMinutes]
  );

  results.push({
    name: 'locks.jobs',
    severity: (jobsRes.rows[0].stale_count as number) > 0 ? 'WARN' : 'CRITICAL',
    ok: (jobsRes.rows[0].stale_count as number) === 0,
    detail: `Stale arb.jobs locks=${jobsRes.rows[0].stale_count}`,
    meta: { staleCount: jobsRes.rows[0].stale_count }
  });

  const jobQueueRes = await pool.query(
    `
    select count(*)::int as stale_count
    from arb.job_queue
    where started_at is not null
      and finished_at is null
      and started_at < now() - make_interval(mins => $1)
      and status = 'RUNNING'
    `,
    [thresholds.staleJobLockMinutes]
  );

  results.push({
    name: 'locks.job_queue',
    severity: (jobQueueRes.rows[0].stale_count as number) > 0 ? 'WARN' : 'CRITICAL',
    ok: (jobQueueRes.rows[0].stale_count as number) === 0,
    detail: `Stale arb.job_queue running rows=${jobQueueRes.rows[0].stale_count}`,
    meta: { staleCount: jobQueueRes.rows[0].stale_count }
  });

  return results;
}

async function checkRecentFailedRuns(): Promise<PreflightCheckResult> {
  const res = await pool.query(
    `
    select count(*)::int as failed_count
    from arb.process_runs
    where status = 'FAILED'
      and created_at >= now() - make_interval(hours => $1)
    `,
    [thresholds.recentFailedRunHours]
  );

  const failedCount = res.rows[0].failed_count as number;

  return {
    name: 'process_runs.recent_failures',
    severity: failedCount > 0 ? 'WARN' : 'INFO',
    ok: failedCount === 0,
    detail: `Failed process_runs in last ${thresholds.recentFailedRunHours}h = ${failedCount}`,
    meta: { failedCount }
  };
}

async function checkProcessRunAnomalies(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  const startedNoFinish = await pool.query(
    `
    select count(*)::int as count
    from arb.process_runs
    where status = 'STARTED'
      and started_at < now() - interval '2 hours'
      and completed_at is null
      and failed_at is null
    `
  );

  results.push({
    name: 'process_runs.long_running_started',
    severity: (startedNoFinish.rows[0].count as number) > 0 ? 'WARN' : 'INFO',
    ok: (startedNoFinish.rows[0].count as number) === 0,
    detail: `Long-running STARTED runs=${startedNoFinish.rows[0].count}`
  });

  const inconsistentSucceeded = await pool.query(
    `
    select count(*)::int as count
    from arb.process_runs
    where status = 'SUCCEEDED'
      and completed_at is null
    `
  );

  results.push({
    name: 'process_runs.succeeded_without_completed_at',
    severity: 'CRITICAL',
    ok: (inconsistentSucceeded.rows[0].count as number) === 0,
    detail: `SUCCEEDED runs missing completed_at=${inconsistentSucceeded.rows[0].count}`
  });

  const inconsistentFailed = await pool.query(
    `
    select count(*)::int as count
    from arb.process_runs
    where status = 'FAILED'
      and failed_at is null
    `
  );

  results.push({
    name: 'process_runs.failed_without_failed_at',
    severity: 'CRITICAL',
    ok: (inconsistentFailed.rows[0].count as number) === 0,
    detail: `FAILED runs missing failed_at=${inconsistentFailed.rows[0].count}`
  });

  return results;
}

async function checkForensicHashIntegrity(): Promise<PreflightCheckResult> {
  const res = await pool.query(
    `
    select count(*)::int as broken_count
    from arb.forensic_events
    where event_hash is null
       or length(event_hash) < 32
    `
  );

  const brokenCount = res.rows[0].broken_count as number;

  return {
    name: 'forensic.hash_integrity',
    severity: 'CRITICAL',
    ok: brokenCount === 0,
    detail: `Forensic events missing/invalid event_hash=${brokenCount}`,
    meta: { brokenCount }
  };
}

async function checkForensicChainContinuitySample(): Promise<PreflightCheckResult> {
  const res = await pool.query(
    `
    with ordered as (
      select
        id,
        process_run_id,
        prev_hash,
        lag(event_hash) over (partition by process_run_id order by id) as expected_prev_hash
      from arb.forensic_events
    )
    select count(*)::int as mismatch_count
    from ordered
    where expected_prev_hash is not null
      and coalesce(prev_hash, '') <> coalesce(expected_prev_hash, '')
    `
  );

  const mismatchCount = res.rows[0].mismatch_count as number;

  return {
    name: 'forensic.hash_chain_continuity',
    severity: 'CRITICAL',
    ok: mismatchCount === 0,
    detail: `Hash-chain mismatches=${mismatchCount}`,
    meta: { mismatchCount }
  };
}

async function checkIdempotencyIntegrity(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  const processRunDupes = await pool.query(
    `
    select count(*)::int as duplicate_groups
    from (
      select process_name, idempotency_key
      from arb.process_runs
      where idempotency_key is not null
      group by process_name, idempotency_key
      having count(*) > 1
    ) x
    `
  );

  results.push({
    name: 'idempotency.process_runs',
    severity: 'CRITICAL',
    ok: (processRunDupes.rows[0].duplicate_groups as number) === 0,
    detail: `Duplicate process_run idempotency groups=${processRunDupes.rows[0].duplicate_groups}`
  });

  const queueDupes = await pool.query(
    `
    select count(*)::int as duplicate_groups
    from (
      select queue_name, idempotency_key
      from arb.queue_idempotency
      group by queue_name, idempotency_key
      having count(*) > 1
    ) x
    `
  );

  results.push({
    name: 'idempotency.queue_idempotency',
    severity: 'CRITICAL',
    ok: (queueDupes.rows[0].duplicate_groups as number) === 0,
    detail: `Duplicate queue idempotency groups=${queueDupes.rows[0].duplicate_groups}`
  });

  return results;
}

async function checkListingEvidenceCoverage(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  const orphaned = await pool.query(
    `
    select count(*)::int as count
    from arb.listing_evidence le
    left join arb.forensic_events fe on fe.id = le.forensic_event_id
    where fe.id is null
    `
  );

  results.push({
    name: 'evidence.listing.orphaned_forensic_event',
    severity: 'CRITICAL',
    ok: (orphaned.rows[0].count as number) === 0,
    detail: `Orphaned listing_evidence rows=${orphaned.rows[0].count}`
  });

  const recentListings = await pool.query(
    `
    select count(*)::int as count
    from arb.listings
    where created_at >= now() - interval '7 days'
    `
  );

  const recentEvidence = await pool.query(
    `
    select count(distinct listing_id)::int as count
    from arb.listing_evidence
    where created_at >= now() - interval '7 days'
      and listing_id is not null
    `
  );

  results.push({
    name: 'evidence.listing.recent_coverage',
    severity: 'INFO',
    ok: true,
    detail: `Recent listings=${recentListings.rows[0].count}, recent listing evidence coverage=${recentEvidence.rows[0].count}`,
    meta: {
      recentListings: recentListings.rows[0].count,
      recentListingEvidence: recentEvidence.rows[0].count
    }
  });

  return results;
}

async function checkShippingEvidenceCoverage(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  const orphaned = await pool.query(
    `
    select count(*)::int as count
    from arb.shipping_evidence se
    left join arb.forensic_events fe on fe.id = se.forensic_event_id
    where fe.id is null
    `
  );

  results.push({
    name: 'evidence.shipping.orphaned_forensic_event',
    severity: 'CRITICAL',
    ok: (orphaned.rows[0].count as number) === 0,
    detail: `Orphaned shipping_evidence rows=${orphaned.rows[0].count}`
  });

  const weakQuotes = await pool.query(
    `
    select count(*)::int as count
    from arb.shipping_evidence
    where quoted_label_cost_usd is null
      and payload_json = '{}'::jsonb
    `
  );

  results.push({
    name: 'evidence.shipping.empty_payloads',
    severity: (weakQuotes.rows[0].count as number) > 0 ? 'WARN' : 'INFO',
    ok: (weakQuotes.rows[0].count as number) === 0,
    detail: `Shipping evidence rows missing both quote and payload=${weakQuotes.rows[0].count}`
  });

  return results;
}

async function checkPricingEvidenceCoverage(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  const orphaned = await pool.query(
    `
    select count(*)::int as count
    from arb.pricing_evidence pe
    left join arb.forensic_events fe on fe.id = pe.forensic_event_id
    where fe.id is null
    `
  );

  results.push({
    name: 'evidence.pricing.orphaned_forensic_event',
    severity: 'CRITICAL',
    ok: (orphaned.rows[0].count as number) === 0,
    detail: `Orphaned pricing_evidence rows=${orphaned.rows[0].count}`
  });

  const incomplete = await pool.query(
    `
    select count(*)::int as count
    from arb.pricing_evidence
    where amount_usd is null
      and expected_profit_usd is null
      and total_cost_basis_usd is null
    `
  );

  results.push({
    name: 'evidence.pricing.empty_payloads',
    severity: (incomplete.rows[0].count as number) > 0 ? 'WARN' : 'INFO',
    ok: (incomplete.rows[0].count as number) === 0,
    detail: `Pricing evidence rows missing amount/profit/cost basis=${incomplete.rows[0].count}`
  });

  return results;
}

async function checkMutationLedgerHealth(): Promise<PreflightCheckResult> {
  const res = await pool.query(
    `
    select count(*)::int as count
    from arb.db_mutation_ledger
    where created_at >= now() - interval '7 days'
    `
  );

  return {
    name: 'ledger.db_mutation_ledger.recent_activity',
    severity: 'INFO',
    ok: true,
    detail: `Recent db_mutation_ledger rows in last 7d=${res.rows[0].count}`
  };
}

async function checkServiceCallLedgerHealth(): Promise<PreflightCheckResult> {
  const failures = await pool.query(
    `
    select count(*)::int as count
    from arb.service_call_ledger
    where called_at >= now() - interval '24 hours'
      and success = false
    `
  );

  return {
    name: 'ledger.service_call_ledger.failures_24h',
    severity: (failures.rows[0].count as number) > 0 ? 'WARN' : 'INFO',
    ok: (failures.rows[0].count as number) === 0,
    detail: `Failed service calls in last 24h=${failures.rows[0].count}`
  };
}

async function checkJournalAndSummaryHealth(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  const journal = await pool.query(
    `
    select count(*)::int as count
    from arb.product_journal
    where created_at >= now() - interval '7 days'
    `
  );

  results.push({
    name: 'journal.product_journal.recent_activity',
    severity: 'INFO',
    ok: true,
    detail: `Recent product_journal rows in last 7d=${journal.rows[0].count}`
  });

  const summaries = await pool.query(
    `
    select count(*)::int as count
    from arb.phase_summary_events
    where created_at >= now() - interval '7 days'
    `
  );

  results.push({
    name: 'journal.phase_summary_events.recent_activity',
    severity: 'INFO',
    ok: true,
    detail: `Recent phase_summary_events rows in last 7d=${summaries.rows[0].count}`
  });

  return results;
}

async function checkMarketIntelHealth(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  const failedRuns = await pool.query(
    `
    select count(*)::int as count
    from arb.market_intel_runs
    where status = 'failed'
      and created_at >= now() - interval '24 hours'
    `
  );

  results.push({
    name: 'market_intel.recent_failed_runs',
    severity: (failedRuns.rows[0].count as number) > 0 ? 'WARN' : 'INFO',
    ok: (failedRuns.rows[0].count as number) === 0,
    detail: `Failed market_intel_runs in 24h=${failedRuns.rows[0].count}`
  });

  const orphanSnapshots = await pool.query(
    `
    select count(*)::int as count
    from arb.ebay_market_snapshots s
    left join arb.market_intel_runs r on r.id = s.run_id
    where r.id is null
    `
  );

  results.push({
    name: 'market_intel.orphaned_snapshots',
    severity: 'CRITICAL',
    ok: (orphanSnapshots.rows[0].count as number) === 0,
    detail: `Orphaned ebay_market_snapshots=${orphanSnapshots.rows[0].count}`
  });

  return results;
}

async function checkOpportunityQueueHealth(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  const orphaned = await pool.query(
    `
    select count(*)::int as count
    from arb.opportunity_queue oq
    left join arb.candidates c on c.id = oq.candidate_id
    where c.id is null
    `
  );

  results.push({
    name: 'opportunity_queue.orphaned_candidates',
    severity: 'CRITICAL',
    ok: (orphaned.rows[0].count as number) === 0,
    detail: `Orphaned opportunity_queue candidate references=${orphaned.rows[0].count}`
  });

  const noQueuedAt = await pool.query(
    `
    select count(*)::int as count
    from arb.opportunity_queue
    where status = 'queued'
      and queued_at is null
    `
  );

  results.push({
    name: 'opportunity_queue.queued_missing_timestamp',
    severity: (noQueuedAt.rows[0].count as number) > 0 ? 'WARN' : 'INFO',
    ok: (noQueuedAt.rows[0].count as number) === 0,
    detail: `Queued opportunity rows missing queued_at=${noQueuedAt.rows[0].count}`
  });

  return results;
}

async function checkCandidatePipelineHealth(): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  const stuck = await pool.query(
    `
    select count(*)::int as count
    from arb.candidates
    where status = 'pending'
      and created_at < now() - interval '24 hours'
      and queued_at is null
    `
  );

  results.push({
    name: 'candidates.pending_unqueued_24h',
    severity: (stuck.rows[0].count as number) > 0 ? 'WARN' : 'INFO',
    ok: (stuck.rows[0].count as number) === 0,
    detail: `Pending candidates older than 24h with no queued_at=${stuck.rows[0].count}`
  });

  const brokenProcessRefs = await pool.query(
    `
    select count(*)::int as count
    from arb.candidates c
    left join arb.process_runs pr on pr.run_id = c.last_process_run_id
    where c.last_process_run_id is not null
      and pr.run_id is null
    `
  );

  results.push({
    name: 'candidates.broken_last_process_run_ref',
    severity: 'CRITICAL',
    ok: (brokenProcessRefs.rows[0].count as number) === 0,
    detail: `Candidates with broken last_process_run_id refs=${brokenProcessRefs.rows[0].count}`
  });

  return results;
}

export function summarizePreflightResults(results: PreflightCheckResult[]): PreflightSummary {
  let criticalFailures = 0;
  let warnings = 0;
  let passed = 0;
  let failed = 0;

  for (const result of results) {
    if (result.ok) {
      passed += 1;
      continue;
    }

    failed += 1;

    if (result.severity === 'CRITICAL') {
      criticalFailures += 1;
    } else if (result.severity === 'WARN') {
      warnings += 1;
    }
  }

  return {
    totalChecks: results.length,
    passed,
    failed,
    warnings,
    criticalFailures
  };
}

export async function runFullPreflightChecks(): Promise<PreflightReport> {
  const results: PreflightCheckResult[] = [];

  results.push(await checkDbConnectivity());
  results.push(await checkRedisConnectivity());
  results.push(await checkMigrationHistory());

  results.push(...await checkRequiredTables());
  results.push(...await checkRequiredColumns());
  results.push(...await checkRequiredIndexes());
  results.push(...await checkProcessRegistry());

  results.push(...await checkQueueHealth());
  results.push(await checkWorkerHeartbeats());

  results.push(await checkStaleCandidateClaims());
  results.push(await checkStaleMarketClaims());
  results.push(await checkStaleProcessStepClaims());
  results.push(...await checkStaleJobLocks());

  results.push(await checkRecentFailedRuns());
  results.push(...await checkProcessRunAnomalies());

  results.push(await checkForensicHashIntegrity());
  results.push(await checkForensicChainContinuitySample());
  results.push(...await checkIdempotencyIntegrity());

  results.push(...await checkListingEvidenceCoverage());
  results.push(...await checkShippingEvidenceCoverage());
  results.push(...await checkPricingEvidenceCoverage());

  results.push(await checkMutationLedgerHealth());
  results.push(await checkServiceCallLedgerHealth());
  results.push(...await checkJournalAndSummaryHealth());

  results.push(...await checkMarketIntelHealth());
  results.push(...await checkOpportunityQueueHealth());
  results.push(...await checkCandidatePipelineHealth());

  return {
    results,
    summary: summarizePreflightResults(results)
  };
}

/**
 * Backward-compatible alias for earlier lighter callers.
 */
export async function runPreflightChecks(): Promise<PreflightReport> {
  return runFullPreflightChecks();
}

export async function closePreflightResources(): Promise<void> {
  try {
    await redisConnection.quit();
  } catch {
    // no-op
  }

  try {
    await pool.end();
  } catch {
    // no-op
  }
}
