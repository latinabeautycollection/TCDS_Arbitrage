import { AiProviderName, AiRoutePerformance, CategorySpecialistName } from '../models/enterpriseListingTypes';

export class AiPerformanceRouter {
  constructor(private readonly performance: AiRoutePerformance[] = []) {}

  chooseProvider(taskName: string, categorySpecialist: CategorySpecialistName, allowed: AiProviderName[] = ['openai', 'claude', 'gemini']): AiProviderName {
    const candidates = this.performance.filter((row) => row.taskName === taskName && row.categorySpecialist === categorySpecialist && allowed.includes(row.provider));
    if (candidates.length === 0) return this.defaultProvider(taskName);
    const ranked = candidates
      .map((row) => ({
        row,
        score: row.successRate * 0.35 + row.averageQualityScore * 0.45 - Math.min(row.averageLatencyMs / 10000, 1) * 0.10 - Math.min(row.averageCostUsd / 0.25, 1) * 0.10,
      }))
      .sort((a, b) => b.score - a.score);
    return ranked[0]!.row.provider;
  }

  private defaultProvider(taskName: string): AiProviderName {
    if (taskName.includes('vision') || taskName.includes('photo')) return 'gemini';
    if (taskName.includes('compliance') || taskName.includes('review') || taskName.includes('disclosure')) return 'claude';
    return 'openai';
  }
}
