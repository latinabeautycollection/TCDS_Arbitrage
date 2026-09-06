export interface HealthMetricSnapshot {
  probesClaimed: number;
  probesCompleted: number;
  probesFailed: number;
  aggregationsChanged: number;
  expiredReconciliations: number;
  ingestRejected: number;
  claimErrors: number;
  lastUpdatedAt: string;
}

export interface HealthMetrics {
  probeClaimed(count: number): void;
  probeCompleted(kind: string, outcome: string, latencyMs?: number): void;
  aggregationChanged(componentId: string, state: string): void;
  expiredReconciled(count: number): void;
  ingestRejected(reason: string): void;
  claimError(kind: string): void;
  snapshot(): HealthMetricSnapshot;
}

export class EnterpriseHealthMetrics implements HealthMetrics {
  private probesClaimed = 0;
  private probesCompleted = 0;
  private probesFailed = 0;
  private aggregationsChanged = 0;
  private expiredReconciliations = 0;
  private rejected = 0;
  private claimErrors = 0;
  private lastUpdatedAt = new Date().toISOString();

  private touch(): void { this.lastUpdatedAt = new Date().toISOString(); }
  probeClaimed(count: number): void { this.probesClaimed += count; this.touch(); }
  probeCompleted(_kind: string, outcome: string, _latencyMs?: number): void {
    this.probesCompleted += 1;
    if (outcome !== "SUCCESS") this.probesFailed += 1;
    this.touch();
  }
  aggregationChanged(_componentId: string, _state: string): void { this.aggregationsChanged += 1; this.touch(); }
  expiredReconciled(count: number): void { this.expiredReconciliations += count; this.touch(); }
  ingestRejected(_reason: string): void { this.rejected += 1; this.touch(); }
  claimError(_kind: string): void { this.claimErrors += 1; this.touch(); }
  snapshot(): HealthMetricSnapshot {
    return {
      probesClaimed: this.probesClaimed,
      probesCompleted: this.probesCompleted,
      probesFailed: this.probesFailed,
      aggregationsChanged: this.aggregationsChanged,
      expiredReconciliations: this.expiredReconciliations,
      ingestRejected: this.rejected,
      claimErrors: this.claimErrors,
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }
}
