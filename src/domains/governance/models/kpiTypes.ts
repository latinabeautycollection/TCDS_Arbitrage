export interface KpiPrincipal {
  reference: string;
  authSessionId: string;
  permissions: string[];
}
export interface KpiWindow { from: Date; to: Date; }
export interface CalculateMetricRequest {
  metricCode: string;
  window: KpiWindow;
  dimensions: Record<string,string>;
  currencyCode?: string;
  idempotencyKey: string;
  restatementReason?: string;
}
export interface KpiSnapshot {
  metric_snapshot_id: string;
  metric_code: string;
  numeric_value: string|null;
  metric_state: string;
  completeness_state: string;
  freshness_state: string;
  reconciliation_state: string;
  window_start: Date|string;
  window_end: Date|string;
  dimensions: Record<string,unknown>;
  generated_at: Date|string;
}
