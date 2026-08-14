
export interface PreSaleGateMetrics {
  claimed(gate: string, count: number): void;
  completed(gate: string, durationMs: number): void;
  failed(gate: string, errorClass: string): void;
  deadLettered(gate: string): void;
  staleRecovered(gate: string, count: number): void;
}

export const noOpPreSaleGateMetrics: PreSaleGateMetrics = {
  claimed: () => undefined,
  completed: () => undefined,
  failed: () => undefined,
  deadLettered: () => undefined,
  staleRecovered: () => undefined,
};
