import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import type { Logger } from '../services/logger';
import type { ScoredFamily } from '../services/prong2Scoring';
import type { WorkerHeartbeatWriteInput } from '../contracts/prong2WorkerHealth';
import type { NormalizedProductIdentity } from '../services/identity/commonIdentity';

export interface MarketStrategy {
  id: number;
  categoryKey: string;
  categoryName: string;
  ebayCategoryId: string | null;
  priority: number;
  metricName: string;
  maxProductsPerRun: number;
  minPriceUsd: number | null;
  maxPriceUsd: number | null;
  minDemandScore: number | null;
  minPredictedProfitUsd: number | null;
  minMarginPct: number | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  notes: string | null;
}

export interface ClaimedSnapshotProduct {
  id: number;
  runId: number;
  snapshotId: number;
  strategyId: number;
  categoryKey: string;
  familyKey: string;
  familyName: string;
  brand: string | null;
  modelFamily: string | null;
  demandScore: number | null;
  priceStabilityScore: number | null;
  competitionScore: number | null;
  propertyroomSupplyFitScore: number | null;
  predictedBuyCostUsd: number | null;
  predictedSalePriceUsd: number | null;
  predictedProfitUsd: number | null;
  predictedMarginPct: number | null;
  overallWatchScore: number | null;
  rawPayloadJson: unknown;
  claimToken: string;
}

export interface ClaimedCandidate {
  candidateId: number;
  listingId: string;
  title: string | null;
  normalizedTitle: string | null;
  brand: string | null;
  model: string | null;
  categoryKey: string | null;
  currentPrice: number | null;
  inboundShippingUsd: number | null;
  claimToken: string;
}

export interface ActiveWatchlistEntry {
  id: number;
  categoryKey: string;
  familyKey: string;
  familyName: string;
  brand: string | null;
  modelFamily: string | null;
  keywordFingerprint: string | null;
  overallWatchScore: number | null;
  predictedBuyCostUsd: number | null;
  predictedSalePriceUsd: number | null;
  predictedProfitUsd: number | null;
  identityJson: Record<string, unknown> | null;
  normalizedBrand: string | null;
  normalizedProductType: string | null;
  normalizedModelFamily: string | null;
  normalizedModelToken: string | null;
  normalizedGeneration: string | null;
  normalizedVariant: string | null;
  normalizedStorage: string | null;
  normalizedColor: string | null;
  normalizedPlatform: string | null;
  canonicalProductKey: string | null;
  identityConfidence: number | null;
  isAccessory: boolean;
  isBundle: boolean;
}

export interface CreateMarketIntelRunInput {
  strategyId: number;
  requestedProductCount: number;
  apiSource: string;
  correlationId: string;
}

export interface CompleteMarketIntelRunInput {
  runId: number;
  receivedProductCount: number;
}

export interface FailMarketIntelRunInput {
  runId: number;
  errorCode: string;
  errorMessage: string;
}

export interface CreateSnapshotInput {
  runId: number;
  strategyId: number;
  categoryKey: string;
  ebayCategoryId: string | null;
  queryContext: Record<string, unknown>;
  itemCount: number;
  avgPriceUsd: number | null;
  medianPriceUsd: number | null;
  rawPayload: unknown;
}

export interface InsertSnapshotProductsInput {
  runId: number;
  snapshotId: number;
  strategyId: number;
  families: ScoredFamily[];
}

export interface ClaimSnapshotProductsInput {
  workerId: string;
  batchSize: number;
  claimTtlSeconds: number;
}

export interface UpsertWatchlistFromClaimedProductInput {
  snapshotProduct: ClaimedSnapshotProduct;
  keywordFingerprint: string;
  activationReason: Record<string, unknown>;
}

export interface RejectClaimedSnapshotProductInput {
  snapshotProductId: number;
  claimToken: string;
  rejectionReasonCode: string;
}

export interface ClaimCandidatesInput {
  workerId: string;
  batchSize: number;
  claimTtlSeconds: number;
}

export interface QueueOpportunityIdempotentInput {
  candidate: ClaimedCandidate;
  watchlistId: number | null;
  matchScore: number;
  priorityScore: number;
  reasonJson: Record<string, unknown>;
}

export interface MarkCandidateNoMatchInput {
  candidateId: number;
  claimToken: string;
  detail: string;
}

export interface MarkCandidateRetryNeededInput {
  candidateId: number;
  claimToken: string;
  detail: string;
}

export interface DeadLetterInsertInput {
  workerName: string;
  entityType: string;
  entityId: string | null;
  failureCode: string;
  failureMessage: string;
  payload: Record<string, unknown>;
}

export class Prong2Repository {
  public constructor(
    private readonly pool: Pool,
    private readonly logger: Logger,
  ) {}

  public async writeHeartbeat<TDetails extends Record<string, unknown>>(
    input: WorkerHeartbeatWriteInput<TDetails>,
  ): Promise<void> {
    await this.query(
      `
      insert into arb.worker_heartbeats (
        worker_name,
        worker_instance_id,
        status,
        details_json,
        last_seen_at
      )
      values ($1, $2, $3, $4::jsonb, now())
      on conflict (worker_name, worker_instance_id)
      do update set
        status = excluded.status,
        details_json = excluded.details_json,
        last_seen_at = now()
      `,
      [
        input.workerName,
        input.workerInstanceId,
        input.status,
        stringifyJson(input.details),
      ],
      'writeHeartbeat',
    );
  }

  public async getActiveStrategies(limit: number): Promise<MarketStrategy[]> {
    const safeLimit = positiveInt(limit, 'limit');

    const result = await this.query(
      `
      select
        id,
        category_key,
        category_name,
        ebay_category_id,
        priority,
        metric_name,
        max_products_per_run,
        min_price_usd,
        max_price_usd,
        min_demand_score,
        min_predicted_profit_usd,
        min_margin_pct,
        include_keywords,
        exclude_keywords,
        notes
      from arb.market_category_strategy
      where is_active = true
      order by priority asc, id asc
      limit $1
      `,
      [safeLimit],
      'getActiveStrategies',
    );

    return result.rows.map((row) => ({
      id: toRequiredNumber(row.id, 'market_category_strategy.id'),
      categoryKey: toRequiredString(row.category_key, 'market_category_strategy.category_key'),
      categoryName: toRequiredString(row.category_name, 'market_category_strategy.category_name'),
      ebayCategoryId: toNullableString(row.ebay_category_id),
      priority: toRequiredNumber(row.priority, 'market_category_strategy.priority'),
      metricName: toRequiredString(row.metric_name, 'market_category_strategy.metric_name'),
      maxProductsPerRun: toRequiredNumber(
        row.max_products_per_run,
        'market_category_strategy.max_products_per_run',
      ),
      minPriceUsd: parseNullableNumber(row.min_price_usd),
      maxPriceUsd: parseNullableNumber(row.max_price_usd),
      minDemandScore: parseNullableNumber(row.min_demand_score),
      minPredictedProfitUsd: parseNullableNumber(row.min_predicted_profit_usd),
      minMarginPct: parseNullableNumber(row.min_margin_pct),
      includeKeywords: toStringArray(row.include_keywords),
      excludeKeywords: toStringArray(row.exclude_keywords),
      notes: toNullableString(row.notes),
    }));
  }

  public async tryAdvisoryLockStrategy(strategyId: number): Promise<boolean> {
    const result = await this.query(
      `select pg_try_advisory_lock($1::bigint) as locked`,
      [strategyId],
      'tryAdvisoryLockStrategy',
    );

    return Boolean(result.rows[0]?.locked);
  }

  public async releaseAdvisoryLockStrategy(strategyId: number): Promise<void> {
    await this.query(
      `select pg_advisory_unlock($1::bigint)`,
      [strategyId],
      'releaseAdvisoryLockStrategy',
    );
  }

public async createMarketIntelRun(input: CreateMarketIntelRunInput): Promise<number> {
  const result = await this.query(
    `
    insert into arb.market_intel_runs (
      strategy_id,
      status,
      api_source,
      metric_name,
      requested_product_count,
      correlation_id,
      started_at,
      created_at,
      updated_at
    )
    values ($1, 'running', $2, 'BEST_SELLING', $3, $4::uuid, now(), now(), now())
    on conflict do nothing
    returning id
    `,
    [
      input.strategyId,
      input.apiSource,
      input.requestedProductCount,
      input.correlationId,
    ],
    'createMarketIntelRun',
  );

  if (result.rows.length > 0) {
    return toRequiredNumber(result.rows[0]?.id, 'market_intel_runs.id');
  }

  // Conflict on ux_market_intel_runs_strategy_active — reuse active run
  const existing = await this.query(
    `SELECT id FROM arb.market_intel_runs
      WHERE strategy_id = $1
        AND status IN ('queued','running','retry_scheduled')
      ORDER BY created_at DESC
      LIMIT 1`,
    [input.strategyId],
    'createMarketIntelRun_reuse',
  );

  return toRequiredNumber(existing.rows[0]?.id, 'market_intel_runs.id');
}

  public async completeMarketIntelRun(input: CompleteMarketIntelRunInput): Promise<void> {
    await this.query(
      `
      update arb.market_intel_runs
      set status = 'completed',
          received_product_count = $2,
          completed_at = now(),
          updated_at = now()
      where id = $1
      `,
      [input.runId, input.receivedProductCount],
      'completeMarketIntelRun',
    );
  }

  public async failMarketIntelRun(input: FailMarketIntelRunInput): Promise<void> {
    await this.query(
      `
      update arb.market_intel_runs
      set status = 'failed',
          error_code = $2,
          error_message = left($3, 2000),
          completed_at = now(),
          updated_at = now()
      where id = $1
      `,
      [input.runId, input.errorCode, input.errorMessage],
      'failMarketIntelRun',
    );
  }

  public async createSnapshot(input: CreateSnapshotInput): Promise<number> {
    const result = await this.query(
      `
      insert into arb.ebay_market_snapshots (
        run_id,
        strategy_id,
        category_key,
        ebay_category_id,
        metric_name,
        query_context_json,
        snapshot_taken_at,
        item_count,
        avg_price_usd,
        median_price_usd,
        raw_payload_json,
        created_at
      )
      values (
        $1, $2, $3, $4, 'BEST_SELLING', $5::jsonb, now(), $6, $7, $8, $9::jsonb, now()
      )
      returning id
      `,
      [
        input.runId,
        input.strategyId,
        input.categoryKey,
        input.ebayCategoryId,
        stringifyJson(input.queryContext),
        input.itemCount,
        input.avgPriceUsd,
        input.medianPriceUsd,
        stringifyJson(input.rawPayload),
      ],
      'createSnapshot',
    );

    return toRequiredNumber(result.rows[0]?.id, 'ebay_market_snapshots.id');
  }

  public async insertSnapshotProducts(input: InsertSnapshotProductsInput): Promise<void> {
    if (input.families.length === 0) {
      return;
    }

    await this.withTransaction('insertSnapshotProducts', async (client) => {
      await this.applyCertificationMode(client);

      for (const family of input.families) {
        await client.query(
          `
          insert into arb.market_snapshot_products (
            run_id,
            snapshot_id,
            strategy_id,
            source_snapshot_id,
            source_rank,
            ebay_item_id,
            category_key,
            family_key,
            family_name,
            brand,
            model_family,
            normalized_title,
            price_low_usd,
            price_mid_usd,
            price_high_usd,
            comp_depth,
            demand_score,
            price_stability_score,
            competition_score,
            propertyroom_supply_fit_score,
            predicted_buy_cost_usd,
            predicted_sale_price_usd,
            predicted_profit_usd,
            predicted_margin_pct,
            overall_watch_score,
            status,
            raw_payload_json,
            created_at,
            updated_at
          )
          values (
            $1, $2, $3, $2, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
            $16, $17, $18, $19, $20, $21, $22, $23, $24, 'scored', $25::jsonb, now(), now()
          )
          on conflict (run_id, family_key)
          do update set
            source_snapshot_id = excluded.source_snapshot_id,
            source_rank = excluded.source_rank,
            ebay_item_id = excluded.ebay_item_id,
            category_key = excluded.category_key,
            family_name = excluded.family_name,
            brand = excluded.brand,
            model_family = excluded.model_family,
            normalized_title = excluded.normalized_title,
            price_low_usd = excluded.price_low_usd,
            price_mid_usd = excluded.price_mid_usd,
            price_high_usd = excluded.price_high_usd,
            comp_depth = excluded.comp_depth,
            demand_score = excluded.demand_score,
            price_stability_score = excluded.price_stability_score,
            competition_score = excluded.competition_score,
            propertyroom_supply_fit_score = excluded.propertyroom_supply_fit_score,
            predicted_buy_cost_usd = excluded.predicted_buy_cost_usd,
            predicted_sale_price_usd = excluded.predicted_sale_price_usd,
            predicted_profit_usd = excluded.predicted_profit_usd,
            predicted_margin_pct = excluded.predicted_margin_pct,
            overall_watch_score = excluded.overall_watch_score,
            status = 'scored',
            raw_payload_json = excluded.raw_payload_json,
            updated_at = now()
          `,
          [
            input.runId,
            input.snapshotId,
            input.strategyId,
            family.sourceRank,
            firstItemId(family),
            family.categoryKey,
            family.familyKey,
            family.familyName,
            family.brand,
            family.modelFamily,
            family.normalizedTitle,
            family.score.soldP25,
            family.score.soldMedian,
            family.score.soldP75,
            family.score.soldCount,
            family.score.demandScore,
            family.score.priceStabilityScore,
            family.score.competitionScore,
            family.score.propertyroomSupplyFitScore,
            family.score.predictedBuyCostUsd,
            family.score.predictedSalePriceUsd,
            family.score.predictedProfitUsd,
            family.score.predictedMarginPct,
            family.score.overallWatchScore,
            stringifyJson({
              soldCount: family.score.soldCount,
              activeCount: family.score.activeCount,
              soldItems: family.soldItems.slice(0, 10),
              activeItems: family.activeItems.slice(0, 10),
              sourceSnapshotId: input.snapshotId,
              certificationMode:
                process.env.PRONG2_CERTIFICATION_MODE === 'true',
            }),
          ],
        );
      }
    });
  }

  public async claimSnapshotProducts(
    input: ClaimSnapshotProductsInput,
  ): Promise<ClaimedSnapshotProduct[]> {
    const result = await this.query(
      `
      with claimable as (
        select p.id
        from arb.market_snapshot_products p
        where p.status = 'scored'
          and (
            p.claim_expires_at is null
            or p.claim_expires_at < now()
          )
        order by p.overall_watch_score desc nulls last, p.id asc
        limit $1
        for update skip locked
      )
      update arb.market_snapshot_products p
      set claim_token = gen_random_uuid(),
          claimed_at = now(),
          claimed_by = $2,
          claim_expires_at = now() + make_interval(secs => $3::int),
          process_attempts = coalesce(p.process_attempts, 0) + 1,
          updated_at = now()
      from claimable c
      where p.id = c.id
      returning
        p.id,
        p.run_id,
        p.snapshot_id,
        p.strategy_id,
        p.category_key,
        p.family_key,
        p.family_name,
        p.brand,
        p.model_family,
        p.demand_score,
        p.price_stability_score,
        p.competition_score,
        p.propertyroom_supply_fit_score,
        p.predicted_buy_cost_usd,
        p.predicted_sale_price_usd,
        p.predicted_profit_usd,
        p.predicted_margin_pct,
        p.overall_watch_score,
        p.raw_payload_json,
        p.claim_token
      `,
      [
        positiveInt(input.batchSize, 'batchSize'),
        input.workerId,
        positiveInt(input.claimTtlSeconds, 'claimTtlSeconds'),
      ],
      'claimSnapshotProducts',
    );

    return result.rows.map((row) => ({
      id: toRequiredNumber(row.id, 'market_snapshot_products.id'),
      runId: toRequiredNumber(row.run_id, 'market_snapshot_products.run_id'),
      snapshotId: toRequiredNumber(row.snapshot_id, 'market_snapshot_products.snapshot_id'),
      strategyId: toRequiredNumber(row.strategy_id, 'market_snapshot_products.strategy_id'),
      categoryKey: toRequiredString(row.category_key, 'market_snapshot_products.category_key'),
      familyKey: toRequiredString(row.family_key, 'market_snapshot_products.family_key'),
      familyName: toRequiredString(row.family_name, 'market_snapshot_products.family_name'),
      brand: toNullableString(row.brand),
      modelFamily: toNullableString(row.model_family),
      demandScore: parseNullableNumber(row.demand_score),
      priceStabilityScore: parseNullableNumber(row.price_stability_score),
      competitionScore: parseNullableNumber(row.competition_score),
      propertyroomSupplyFitScore: parseNullableNumber(row.propertyroom_supply_fit_score),
      predictedBuyCostUsd: parseNullableNumber(row.predicted_buy_cost_usd),
      predictedSalePriceUsd: parseNullableNumber(row.predicted_sale_price_usd),
      predictedProfitUsd: parseNullableNumber(row.predicted_profit_usd),
      predictedMarginPct: parseNullableNumber(row.predicted_margin_pct),
      overallWatchScore: parseNullableNumber(row.overall_watch_score),
      rawPayloadJson: row.raw_payload_json,
      claimToken: toRequiredString(row.claim_token, 'market_snapshot_products.claim_token'),
    }));
  }

  public async upsertWatchlistFromClaimedProduct(
    input: UpsertWatchlistFromClaimedProductInput,
  ): Promise<void> {
    await this.withTransaction('upsertWatchlistFromClaimedProduct', async (client) => {
      await client.query(
        `
        insert into arb.product_watchlist (
          strategy_id,
          category_key,
          family_key,
          family_name,
          brand,
          model_family,
          keyword_fingerprint,
          source_snapshot_ids,
          demand_score,
          price_stability_score,
          competition_score,
          propertyroom_supply_fit_score,
          profitability_score,
          overall_watch_score,
          predicted_buy_cost_usd,
          predicted_sale_price_usd,
          predicted_profit_usd,
          predicted_margin_pct,
          status,
          activation_reason_json,
          last_seen_at,
          created_at,
          updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8::bigint[], $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, 'active', $19::jsonb, now(), now(), now()
        )
        on conflict (family_key)
        do update set
          strategy_id = excluded.strategy_id,
          category_key = excluded.category_key,
          family_name = excluded.family_name,
          brand = excluded.brand,
          model_family = excluded.model_family,
          keyword_fingerprint = excluded.keyword_fingerprint,
          source_snapshot_ids = excluded.source_snapshot_ids,
          demand_score = excluded.demand_score,
          price_stability_score = excluded.price_stability_score,
          competition_score = excluded.competition_score,
          propertyroom_supply_fit_score = excluded.propertyroom_supply_fit_score,
          profitability_score = excluded.profitability_score,
          overall_watch_score = excluded.overall_watch_score,
          predicted_buy_cost_usd = excluded.predicted_buy_cost_usd,
          predicted_sale_price_usd = excluded.predicted_sale_price_usd,
          predicted_profit_usd = excluded.predicted_profit_usd,
          predicted_margin_pct = excluded.predicted_margin_pct,
          status = 'active',
          activation_reason_json = excluded.activation_reason_json,
          last_seen_at = now(),
          updated_at = now()
        `,
        [
          input.snapshotProduct.strategyId,
          input.snapshotProduct.categoryKey,
          input.snapshotProduct.familyKey,
          input.snapshotProduct.familyName,
          input.snapshotProduct.brand,
          input.snapshotProduct.modelFamily,
          input.keywordFingerprint,
          [input.snapshotProduct.snapshotId],
          input.snapshotProduct.demandScore,
          input.snapshotProduct.priceStabilityScore,
          input.snapshotProduct.competitionScore,
          input.snapshotProduct.propertyroomSupplyFitScore,
          input.snapshotProduct.predictedProfitUsd,
          input.snapshotProduct.overallWatchScore,
          input.snapshotProduct.predictedBuyCostUsd,
          input.snapshotProduct.predictedSalePriceUsd,
          input.snapshotProduct.predictedProfitUsd,
          input.snapshotProduct.predictedMarginPct,
          stringifyJson(input.activationReason),
        ],
      );

      const updateResult = await client.query(
        `
        update arb.market_snapshot_products
        set status = 'accepted',
            claim_expires_at = null,
            updated_at = now()
        where id = $1
          and claim_token = $2::uuid
        `,
        [input.snapshotProduct.id, input.snapshotProduct.claimToken],
      );

      assertSingleRowUpdated(
        updateResult,
        'upsertWatchlistFromClaimedProduct',
        `snapshot product claim token mismatch for id=${input.snapshotProduct.id}`,
      );
    });
  }

  public async rejectClaimedSnapshotProduct(
    input: RejectClaimedSnapshotProductInput,
  ): Promise<void> {
    const result = await this.query(
      `
      update arb.market_snapshot_products
      set status = 'rejected',
          rejection_reason_code = $3,
          claim_expires_at = null,
          updated_at = now()
      where id = $1
        and claim_token = $2::uuid
      `,
      [input.snapshotProductId, input.claimToken, input.rejectionReasonCode],
      'rejectClaimedSnapshotProduct',
    );

    assertSingleRowUpdated(
      result,
      'rejectClaimedSnapshotProduct',
      `snapshot product claim token mismatch for id=${input.snapshotProductId}`,
    );
  }

  public async ensureCandidatesFromListings(limit: number): Promise<number> {
    const result = await this.query(
      `
      insert into arb.candidates (
        listing_id,
        status,
        brand,
        model,
        title,
        normalized_title,
        condition_text,
        source_category_key,
        current_price,
        inbound_shipping_usd,
        candidate_confidence,
        created_at,
        updated_at
      )
      select
        l.id,
        'pending',
        l.brand,
        l.model,
        l.title,
        l.normalized_title,
        l.condition_text,
        coalesce(l.category_id, l.category_key),
        coalesce(l.buy_now_price, l.current_bid_price, l.current_price),
        l.inbound_shipping_usd,
        0.50,
        now(),
        now()
      from arb.listings l
      left join arb.candidates c
        on c.listing_id = l.id
      where c.id is null
        and l.platform::text = 'propertyroom'
      order by l.updated_at desc
      limit $1
      `,
      [positiveInt(limit, 'limit')],
      'ensureCandidatesFromListings',
    );

    return result.rowCount ?? 0;
  }

  public async getActiveWatchlist(limit: number): Promise<ActiveWatchlistEntry[]> {
    const result = await this.query(
      `
      select
        id,
        category_key,
        family_key,
        family_name,
        brand,
        model_family,
        keyword_fingerprint,
        overall_watch_score,
        predicted_buy_cost_usd,
        predicted_sale_price_usd,
        predicted_profit_usd,
        identity_json,
        normalized_brand,
        normalized_product_type,
        normalized_model_family,
        normalized_model_token,
        normalized_generation,
        normalized_variant,
        normalized_storage,
        normalized_color,
        normalized_platform,
        canonical_product_key,
        identity_confidence,
        is_accessory,
        is_bundle
      from arb.product_watchlist
      where status = 'active'
      order by overall_watch_score desc nulls last, id asc
      limit $1
      `,
      [positiveInt(limit, 'limit')],
      'getActiveWatchlist',
    );

    return result.rows.map((row) => ({
      id: toRequiredNumber(row.id, 'product_watchlist.id'),
      categoryKey: toRequiredString(row.category_key, 'product_watchlist.category_key'),
      familyKey: toRequiredString(row.family_key, 'product_watchlist.family_key'),
      familyName: toRequiredString(row.family_name, 'product_watchlist.family_name'),
      brand: toNullableString(row.brand),
      modelFamily: toNullableString(row.model_family),
      keywordFingerprint: toNullableString(row.keyword_fingerprint),
      overallWatchScore: parseNullableNumber(row.overall_watch_score),
      predictedBuyCostUsd: parseNullableNumber(row.predicted_buy_cost_usd),
      predictedSalePriceUsd: parseNullableNumber(row.predicted_sale_price_usd),
      predictedProfitUsd: parseNullableNumber(row.predicted_profit_usd),
      identityJson: row.identity_json ? (typeof row.identity_json === 'string' ? JSON.parse(row.identity_json) : row.identity_json) : null,
      normalizedBrand: toNullableString(row.normalized_brand),
      normalizedProductType: toNullableString(row.normalized_product_type),
      normalizedModelFamily: toNullableString(row.normalized_model_family),
      normalizedModelToken: toNullableString(row.normalized_model_token),
      normalizedGeneration: toNullableString(row.normalized_generation),
      normalizedVariant: toNullableString(row.normalized_variant),
      normalizedStorage: toNullableString(row.normalized_storage),
      normalizedColor: toNullableString(row.normalized_color),
      normalizedPlatform: toNullableString(row.normalized_platform),
      canonicalProductKey: toNullableString(row.canonical_product_key),
      identityConfidence: parseNullableNumber(row.identity_confidence),
      isAccessory: row.is_accessory === true,
      isBundle: row.is_bundle === true,
    }));
  }

  public async claimCandidates(input: ClaimCandidatesInput): Promise<ClaimedCandidate[]> {
    const result = await this.query(
      `
      with claimable as (
        select c.id
        from arb.candidates c
        where c.status in ('pending', 'retry_needed')
          and (
            c.claim_expires_at is null
            or c.claim_expires_at < now()
          )
        order by c.updated_at asc, c.id asc
        limit $1
        for update skip locked
      )
      update arb.candidates c
      set claim_token = gen_random_uuid(),
          claimed_at = now(),
          claimed_by = $2,
          claim_expires_at = now() + make_interval(secs => $3::int),
          process_attempts = coalesce(c.process_attempts, 0) + 1,
          updated_at = now()
      from claimable x
      where c.id = x.id
      returning
        c.id as candidate_id,
        c.listing_id,
        c.title,
        c.normalized_title,
        c.brand,
        c.model,
        c.source_category_key,
        c.current_price,
        c.inbound_shipping_usd,
        c.claim_token
      `,
      [
        positiveInt(input.batchSize, 'batchSize'),
        input.workerId,
        positiveInt(input.claimTtlSeconds, 'claimTtlSeconds'),
      ],
      'claimCandidates',
    );

    return result.rows.map((row) => ({
      candidateId: toRequiredNumber(row.candidate_id, 'candidates.id'),
      listingId: toRequiredString(row.listing_id, 'candidates.listing_id'),
      title: toNullableString(row.title),
      normalizedTitle: toNullableString(row.normalized_title),
      brand: toNullableString(row.brand),
      model: toNullableString(row.model),
      categoryKey: toNullableString(row.source_category_key),
      currentPrice: parseNullableNumber(row.current_price),
      inboundShippingUsd: parseNullableNumber(row.inbound_shipping_usd),
      claimToken: toRequiredString(row.claim_token, 'candidates.claim_token'),
    }));
  }

  public async queueOpportunityIdempotent(
    input: QueueOpportunityIdempotentInput,
  ): Promise<boolean> {
    return this.withTransaction('queueOpportunityIdempotent', async (client) => {
      const candidateId = input.candidate.candidateId;

      const opportunityResult = await client.query(
        `
        insert into arb.opportunity_queue (
          candidate_id, watchlist_id, match_score, priority_score, status, reason_json, created_at, updated_at, queued_at
        )
        select c.id, $2, $3, $4, 'queued', $5::jsonb, now(), now(), now()
        from arb.candidates c
        join arb.listings l on l.id = c.listing_id
        where c.id = $1
          and c.status not in ('buy', 'profit_pass', 'profit_blocked', 'rejected', 'purchased')
          and (l.end_time is null or l.end_time > now())
        on conflict do nothing
        returning id
        `,
        [candidateId, input.watchlistId, input.matchScore, input.priorityScore, stringifyJson(input.reasonJson)],
      );

      await client.query(
        `
        update arb.candidates
        set
          status = 'queued',
          lifecycle_status = case
            when lifecycle_status in ('SEEDED', 'MATCHED', 'RECOVERED_NEEDS_EBAY_SEARCH') then 'QUEUED_FOR_EBAY_SEARCH'
            else lifecycle_status
          end,
          matched_watchlist_id = $2,
          matched_at = coalesce(matched_at, now()),
          queued_at = coalesce(queued_at, now()),
          claim_expires_at = null,
          rejection_reason_code = null,
          rejection_reason_detail = null,
          review_required = false,
          updated_at = now()
        where id = $1
          and status not in ('buy', 'profit_pass', 'profit_blocked', 'rejected', 'purchased')
        `,
        [candidateId, input.watchlistId],
      );

      await client.query(
        `
        insert into arb.ebay_search_jobs (
          candidate_id, job_type, status, api_source, run_context, search_plan_json, request_meta_json,
          priority, correlation_id, analysis_prong, identity_gate_passed, identity_gate_reason_json, created_at, updated_at
        )
        select
          c.id, 'candidate_comp', 'queued', 'browse', 'opportunity_queue',
          jsonb_build_array(jsonb_build_object(
            'query', coalesce(nullif(c.normalized_title, ''), c.title),
            'title', c.title, 'brand', c.brand, 'model', c.model, 'mpn', c.mpn, 'condition', c.condition_text
          )),
          jsonb_build_object(
            'source', 'queueOpportunityIdempotent', 'listing_id', c.listing_id, 'watchlist_id', $2::bigint,
            'match_score', $3::numeric, 'priority_score', $4::numeric,
            'guarantee', 'every_queued_candidate_gets_candidate_comp_search'
          ),
          greatest(1, least(100, round(100 - ($4::numeric * 100))::int)),
          gen_random_uuid(), 'PRONG2', true,
          jsonb_build_array(jsonb_build_object(
            'reason', 'candidate_must_receive_ebay_comp_search',
            'gate', 'watchlist_is_priority_signal_not_eligibility_gate'
          )),
          now(), now()
        from arb.candidates c
        join arb.listings l on l.id = c.listing_id
        where c.id = $1
          and c.status not in ('buy', 'profit_pass', 'profit_blocked', 'rejected', 'purchased')
          and (l.end_time is null or l.end_time > now())
        on conflict (candidate_id, job_type)
          where (job_type = 'candidate_comp' and status in ('queued', 'running', 'retry_scheduled'))
        do nothing
        `,
        [candidateId, input.watchlistId, input.matchScore, input.priorityScore],
      );

      return (opportunityResult.rowCount ?? 0) === 1;
    });
  }

  public async markCandidateNoMatch(input: MarkCandidateNoMatchInput): Promise<void> {
    const result = await this.query(
      `
      update arb.candidates
      set status = 'no_match',
          rejection_reason_detail = left($3, 1000),
          claim_expires_at = null,
          updated_at = now()
      where id = $1
        and claim_token = $2::uuid
      `,
      [input.candidateId, input.claimToken, input.detail],
      'markCandidateNoMatch',
    );

    assertSingleRowUpdated(
      result,
      'markCandidateNoMatch',
      `candidate claim token mismatch for id=${input.candidateId}`,
    );
  }

  public async markCandidateRetryNeeded(input: MarkCandidateRetryNeededInput): Promise<void> {
    const result = await this.query(
      `
      update arb.candidates
      set status = 'retry_needed',
          process_last_error = left($3, 1000),
          process_last_error_at = now(),
          claim_expires_at = null,
          updated_at = now()
      where id = $1
        and claim_token = $2::uuid
      `,
      [input.candidateId, input.claimToken, input.detail],
      'markCandidateRetryNeeded',
    );

    assertSingleRowUpdated(
      result,
      'markCandidateRetryNeeded',
      `candidate claim token mismatch for id=${input.candidateId}`,
    );
  }

  public async insertDeadLetter(input: DeadLetterInsertInput): Promise<void> {
    await this.query(
      `
      insert into arb.prong2_dead_letter (
        worker_name,
        entity_type,
        entity_id,
        failure_code,
        failure_message,
        payload,
        created_at
      )
      values ($1, $2, $3, $4, left($5, 2000), $6::jsonb, now())
      `,
      [
        input.workerName,
        input.entityType,
        input.entityId,
        input.failureCode,
        input.failureMessage,
        stringifyJson(input.payload),
      ],
      'insertDeadLetter',
    );
  }

  public async insertMarketIntelDebug(input: {
    strategyId: number;
    runId: number | null;
    categoryKey: string;
    phase: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.query(
      `
      insert into arb.market_intel_debug (
        strategy_id,
        run_id,
        category_key,
        phase,
        payload_json,
        created_at
      )
      values ($1, $2, $3, $4, $5::jsonb, now())
      `,
      [
        input.strategyId,
        input.runId,
        input.categoryKey,
        input.phase,
        JSON.stringify(input.payload),
      ],
      'insertMarketIntelDebug',
    );
  }

  private async applyCertificationMode(client: PoolClient): Promise<void> {
    const certificationMode =
      process.env.PRONG2_CERTIFICATION_MODE === 'true' ? 'on' : 'off';

    await client.query(
      `select set_config('arb.certification_mode', $1, true)`,
      [certificationMode],
    );
  }

  private async query<TRow extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[],
    operation: string,
  ): Promise<QueryResult<TRow>> {
    try {
      return await this.pool.query<TRow>(sql, params as any[]);
    } catch (error) {
      this.logger.error('prong2 repository query failed', {
        operation,
        error,
      });
      throw error;
    }
  }

  private async withTransaction<T>(
    operation: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await safeRollback(client, this.logger, operation);
      this.logger.error('prong2 repository transaction failed', {
        operation,
        error,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  public async updateCandidateIdentity(input: {
    candidateId: number;
    identity: NormalizedProductIdentity;
  }): Promise<void> {
    await this.query(
      `
      update arb.candidates
      set
        normalized_brand = $2,
        normalized_product_type = $3,
        normalized_model_family = $4,
        normalized_model_token = $5,
        normalized_generation = $6,
        normalized_variant = $7,
        normalized_storage = $8,
        normalized_color = $9,
        normalized_platform = $10,
        canonical_product_key = $11,
        identity_confidence = $12,
        is_accessory = $13,
        is_bundle = $14,
        identity_json = $15::jsonb,
        updated_at = now()
      where id = $1
      `,
      [
        input.candidateId,
        input.identity.normalizedBrand,
        input.identity.normalizedProductType,
        input.identity.normalizedModelFamily,
        input.identity.normalizedModelToken,
        input.identity.normalizedGeneration,
        input.identity.normalizedVariant,
        input.identity.normalizedStorage,
        input.identity.normalizedColor,
        input.identity.normalizedPlatform,
        input.identity.canonicalProductKey,
        input.identity.identityConfidence,
        input.identity.isAccessory,
        input.identity.isBundle,
        stringifyJson(input.identity),
      ],
      'updateCandidateIdentity',
    );
  }

  public async updateWatchlistIdentity(input: {
    watchlistId: number;
    identity: NormalizedProductIdentity;
  }): Promise<void> {
    await this.query(
      `
      update arb.product_watchlist
      set
        normalized_brand = $2,
        normalized_product_type = $3,
        normalized_model_family = $4,
        normalized_model_token = $5,
        normalized_generation = $6,
        normalized_variant = $7,
        normalized_storage = $8,
        normalized_color = $9,
        normalized_platform = $10,
        canonical_product_key = $11,
        identity_confidence = $12,
        is_accessory = $13,
        is_bundle = $14,
        identity_json = $15::jsonb,
        updated_at = now()
      where id = $1
      `,
      [
        input.watchlistId,
        input.identity.normalizedBrand,
        input.identity.normalizedProductType,
        input.identity.normalizedModelFamily,
        input.identity.normalizedModelToken,
        input.identity.normalizedGeneration,
        input.identity.normalizedVariant,
        input.identity.normalizedStorage,
        input.identity.normalizedColor,
        input.identity.normalizedPlatform,
        input.identity.canonicalProductKey,
        input.identity.identityConfidence,
        input.identity.isAccessory,
        input.identity.isBundle,
        stringifyJson(input.identity),
      ],
      'updateWatchlistIdentity',
    );
  }

  public async getNarrowedActiveWatchlist(input: {
    categoryKey: string | null;
    normalizedBrand: string | null;
    normalizedProductType: string | null;
    limit: number;
  }): Promise<ActiveWatchlistEntry[]> {
    const result = await this.query(
      `
      select
        id,
        category_key,
        family_key,
        family_name,
        brand,
        model_family,
        keyword_fingerprint,
        overall_watch_score,
        predicted_buy_cost_usd,
        predicted_sale_price_usd,
        predicted_profit_usd,
        normalized_brand,
        normalized_product_type,
        normalized_model_family,
        normalized_model_token,
        normalized_generation,
        normalized_variant,
        normalized_storage,
        normalized_color,
        normalized_platform,
        canonical_product_key,
        identity_confidence,
        is_accessory,
        is_bundle,
        identity_json
      from arb.product_watchlist
      where status = 'active'
        and ($1::text is null or category_key = $1)
        and (
          $2::text is null
          or normalized_brand = $2
          or normalized_brand is null
        )
        and (
          $3::text is null
          or normalized_product_type = $3
          or normalized_product_type is null
        )
      order by overall_watch_score desc nulls last, id asc
      limit $4
      `,
      [input.categoryKey, input.normalizedBrand, input.normalizedProductType, positiveInt(input.limit, 'limit')],
      'getNarrowedActiveWatchlist',
    );

    return result.rows.map((row) => ({
      id: toRequiredNumber(row.id, 'product_watchlist.id'),
      categoryKey: toRequiredString(row.category_key, 'product_watchlist.category_key'),
      familyKey: toRequiredString(row.family_key, 'product_watchlist.family_key'),
      familyName: toRequiredString(row.family_name, 'product_watchlist.family_name'),
      brand: toNullableString(row.brand),
      modelFamily: toNullableString(row.model_family),
      keywordFingerprint: toNullableString(row.keyword_fingerprint),
      overallWatchScore: parseNullableNumber(row.overall_watch_score),
      predictedBuyCostUsd: parseNullableNumber(row.predicted_buy_cost_usd),
      predictedSalePriceUsd: parseNullableNumber(row.predicted_sale_price_usd),
      predictedProfitUsd: parseNullableNumber(row.predicted_profit_usd),
      normalizedBrand: toNullableString((row as Record<string, unknown>).normalized_brand),
      normalizedProductType: toNullableString((row as Record<string, unknown>).normalized_product_type),
      normalizedModelFamily: toNullableString((row as Record<string, unknown>).normalized_model_family),
      normalizedModelToken: toNullableString((row as Record<string, unknown>).normalized_model_token),
      normalizedGeneration: toNullableString((row as Record<string, unknown>).normalized_generation),
      normalizedVariant: toNullableString((row as Record<string, unknown>).normalized_variant),
      normalizedStorage: toNullableString((row as Record<string, unknown>).normalized_storage),
      normalizedColor: toNullableString((row as Record<string, unknown>).normalized_color),
      normalizedPlatform: toNullableString((row as Record<string, unknown>).normalized_platform),
      canonicalProductKey: toNullableString((row as Record<string, unknown>).canonical_product_key),
      identityConfidence: parseNullableNumber((row as Record<string, unknown>).identity_confidence),
      isAccessory: Boolean((row as Record<string, unknown>).is_accessory),
      isBundle: Boolean((row as Record<string, unknown>).is_bundle),
      identityJson: (row as Record<string, unknown>).identity_json ?? {},
    })) as ActiveWatchlistEntry[];
  }

  public async saveCandidateBestMatch(input: {
    candidateId: number;
    bestWatchlistId: number | null;
    bestMatchScore: number | null;
    bestMatchReasonJson: Record<string, unknown>;
    finalStatus: 'no_match' | 'matched' | 'queued';
  }): Promise<void> {
    await this.query(
      `
      update arb.candidates
      set
        best_watchlist_id = $2,
        best_match_score = $3,
        best_match_reason_json = $4::jsonb,
        status = $5,
        rejection_reason_detail = case when $5 = 'no_match' then left(coalesce(($4::jsonb -> 'summary' ->> 'reason'), 'no_match'), 1000) else rejection_reason_detail end,
        claim_expires_at = null,
        updated_at = now()
      where id = $1
      `,
      [
        input.candidateId,
        input.bestWatchlistId,
        input.bestMatchScore,
        stringifyJson(input.bestMatchReasonJson),
        input.finalStatus,
      ],
      'saveCandidateBestMatch',
    );
  }
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRequiredNumber(value: unknown, fieldName: string): number {
  const parsed = parseNullableNumber(value);
  if (parsed === null) {
    throw new Error(`Expected numeric value for ${fieldName}`);
  }
  return parsed;
}

function toRequiredString(value: unknown, fieldName: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (value !== null && value !== undefined) {
    const coerced = String(value).trim();
    if (coerced.length > 0) {
      return coerced;
    }
  }

  throw new Error(`Expected string value for ${fieldName}`);
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const coerced = String(value).trim();
  return coerced.length > 0 ? coerced : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);
}

function positiveInt(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return value;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function assertSingleRowUpdated(
  result: QueryResult,
  operation: string,
  message: string,
): void {
  if ((result.rowCount ?? 0) !== 1) {
    throw new Error(`${operation}: ${message}`);
  }
}

function firstItemId(family: ScoredFamily): string | null {
  if (family.soldItems.length > 0) {
    return family.soldItems[0]?.itemId ?? null;
  }

  if (family.activeItems.length > 0) {
    return family.activeItems[0]?.itemId ?? null;
  }

  return null;
}

async function safeRollback(
  client: PoolClient,
  logger: Logger,
  operation: string,
): Promise<void> {
  try {
    await client.query('rollback');
  } catch (error) {
    logger.error('rollback failed', {
      operation,
      error,
    });
  }
}
