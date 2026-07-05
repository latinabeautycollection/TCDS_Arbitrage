import type { Pool } from 'pg';
import { R2CostAnalyticsService } from '../services/r2CostAnalyticsService';

export class R2CostRollupWorker {
  constructor(private readonly pool: Pool) {}
  async runOnce(processRunId?: string) {
    const service = new R2CostAnalyticsService(this.pool);
    await service.rollupToday(processRunId);
    return service.currentSummary();
  }
}
