
export interface DomainReleaseMetrics {
  certificationStarted(environment: string): void;
  certificationCompleted(status: string): void;
  findingOpened(severity: string): void;
  deploymentCheckpoint(status: string): void;
  rollbackStarted(strategy: string): void;
  releaseDecision(decision: string): void;
}
