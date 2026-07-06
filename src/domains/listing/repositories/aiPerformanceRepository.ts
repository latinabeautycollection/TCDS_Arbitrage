import { Pool } from 'pg';
import { getPool } from './db';
import { AiRoutePerformance } from '../models/enterpriseListingTypes';

export class AiPerformanceRepository {
  constructor(private readonly db: Pool = getPool()) {}

  async listPerformance(): Promise<AiRoutePerformance[]> {
    const result = await this.db.query(`
      select provider, task_name as "taskName", category_specialist as "categorySpecialist",
             success_rate::float as "successRate", average_quality_score::float as "averageQualityScore",
             average_latency_ms::float as "averageLatencyMs", average_cost_usd::float as "averageCostUsd",
             last_used_at as "lastUsedAt"
      from arb.listing_ai_route_performance
      where is_enabled = true
    `);
    return result.rows;
  }

  async recordCall(input: { provider: string; taskName: string; categorySpecialist: string; qualityScore: number; latencyMs: number; costUsd: number; success: boolean; }): Promise<void> {
    await this.db.query(`
      insert into arb.listing_ai_route_performance(provider, task_name, category_specialist, success_rate, average_quality_score, average_latency_ms, average_cost_usd, sample_count, last_used_at)
      values ($1,$2,$3,$4,$5,$6,$7,1,now())
      on conflict(provider, task_name, category_specialist) do update set
        sample_count = arb.listing_ai_route_performance.sample_count + 1,
        success_rate = ((arb.listing_ai_route_performance.success_rate * arb.listing_ai_route_performance.sample_count) + $4) / (arb.listing_ai_route_performance.sample_count + 1),
        average_quality_score = ((arb.listing_ai_route_performance.average_quality_score * arb.listing_ai_route_performance.sample_count) + $5) / (arb.listing_ai_route_performance.sample_count + 1),
        average_latency_ms = ((arb.listing_ai_route_performance.average_latency_ms * arb.listing_ai_route_performance.sample_count) + $6) / (arb.listing_ai_route_performance.sample_count + 1),
        average_cost_usd = ((arb.listing_ai_route_performance.average_cost_usd * arb.listing_ai_route_performance.sample_count) + $7) / (arb.listing_ai_route_performance.sample_count + 1),
        last_used_at = now()
    `, [input.provider, input.taskName, input.categorySpecialist, input.success ? 1 : 0, input.qualityScore, input.latencyMs, input.costUsd]);
  }
}
