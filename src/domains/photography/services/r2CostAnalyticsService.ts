import type { Pool } from 'pg';
import { R2StorageOptimizationRepository } from '../repositories/r2StorageOptimizationRepository';

export interface R2CostSummary {
  monthStart: string;
  bucketCount: number;
  objectCount: number;
  totalGb: number;
  estimatedMonthlyCostUsd: number;
  warnings: string[];
}

export class R2CostAnalyticsService {
  private readonly repo: R2StorageOptimizationRepository;
  constructor(private readonly pool: Pool) { this.repo = new R2StorageOptimizationRepository(pool); }

  async rollupToday(processRunId?: string): Promise<void> {
    await this.repo.rollupBucketUsage(new Date().toISOString().slice(0, 10), processRunId);
    await this.pool.query(
      `INSERT INTO arb.r2_listing_storage_cost_monthly(month_start,listing_id,candidate_id,source_listing_normalized_id,category_key,object_count,total_bytes,standard_bytes,ia_bytes,estimated_storage_cost_usd,estimated_total_cost_usd,process_run_id)
       SELECT date_trunc('month', now())::date,
              r.listing_id,
              r.candidate_id,
              r.source_listing_normalized_id,
              COALESCE(l.category_key, c.source_category_key),
              count(*),
              COALESCE(sum(r.size_bytes),0),
              COALESCE(sum(CASE WHEN r.storage_class='Standard' THEN r.size_bytes ELSE 0 END),0),
              COALESCE(sum(CASE WHEN r.storage_class='InfrequentAccess' THEN r.size_bytes ELSE 0 END),0),
              COALESCE(sum(CASE WHEN r.storage_class='InfrequentAccess' THEN r.size_bytes::numeric/1024/1024/1024*0.01 ELSE r.size_bytes::numeric/1024/1024/1024*0.015 END),0),
              COALESCE(sum(CASE WHEN r.storage_class='InfrequentAccess' THEN r.size_bytes::numeric/1024/1024/1024*0.01 ELSE r.size_bytes::numeric/1024/1024/1024*0.015 END),0),
              $1
       FROM arb.r2_object_registry r
       LEFT JOIN arb.listings l ON l.id = r.listing_id
       LEFT JOIN arb.candidates c ON c.id = r.candidate_id
       WHERE r.lifecycle_status <> 'deleted'
       GROUP BY r.listing_id, r.candidate_id, r.source_listing_normalized_id, COALESCE(l.category_key, c.source_category_key)
       ON CONFLICT(month_start, listing_id, candidate_id, source_listing_normalized_id) DO UPDATE SET
         object_count=EXCLUDED.object_count,
         total_bytes=EXCLUDED.total_bytes,
         standard_bytes=EXCLUDED.standard_bytes,
         ia_bytes=EXCLUDED.ia_bytes,
         estimated_storage_cost_usd=EXCLUDED.estimated_storage_cost_usd,
         estimated_total_cost_usd=EXCLUDED.estimated_total_cost_usd`,
      [processRunId ?? null],
    );
  }

  async currentSummary(): Promise<R2CostSummary> {
    const result = await this.pool.query(`SELECT count(DISTINCT bucket_name)::int AS bucket_count, count(*)::int AS object_count, COALESCE(sum(size_bytes),0)::bigint AS bytes, COALESCE(sum(CASE WHEN storage_class='InfrequentAccess' THEN size_bytes::numeric/1024/1024/1024*0.01 ELSE size_bytes::numeric/1024/1024/1024*0.015 END),0)::numeric AS cost FROM arb.r2_object_registry WHERE lifecycle_status <> 'deleted'`);
    const row = result.rows[0];
    const totalGb = Number(row.bytes) / 1024 / 1024 / 1024;
    const warnings: string[] = [];
    if (totalGb > 5000) warnings.push('R2_STORAGE_OVER_5TB_REVIEW_LIFECYCLE');
    if (Number(row.cost) > 500) warnings.push('R2_MONTHLY_COST_OVER_500_REVIEW_BUCKET_ROLLOVERS');
    return { monthStart: new Date().toISOString().slice(0, 7) + '-01', bucketCount: Number(row.bucket_count), objectCount: Number(row.object_count), totalGb, estimatedMonthlyCostUsd: Number(row.cost), warnings };
  }
}
