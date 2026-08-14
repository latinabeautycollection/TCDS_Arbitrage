
export interface IntelligenceMetrics {
  outcomeObserved(type: string): void;
  lossAttributed(stage: string, amount: number): void;
  rootCauseApproved(family: string): void;
  learningExampleEligible(): void;
  recommendationGenerated(type: string): void;
  experimentGuardrailBreached(metric: string): void;
  forecastGenerated(horizonDays: number): void;
}
