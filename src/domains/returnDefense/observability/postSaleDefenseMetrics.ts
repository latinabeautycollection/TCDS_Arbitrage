
export interface PostSaleDefenseMetrics {
  gateClaimed(gate: string): void;
  gateCompleted(gate: string, durationMs: number): void;
  gateFailed(gate: string, errorClass: string): void;
  interventionCreated(type: string): void;
  recoveryReceived(type: string, amountUsd: number): void;
  recoveryDeadlineEscalated(type: string): void;
  deadLettered?(gate: string): void;
}

export const noOpPostSaleDefenseMetrics: PostSaleDefenseMetrics = {
  gateClaimed: () => undefined,
  gateCompleted: () => undefined,
  gateFailed: () => undefined,
  interventionCreated: () => undefined,
  recoveryReceived: () => undefined,
  recoveryDeadlineEscalated: () => undefined,
  deadLettered: () => undefined,
};
