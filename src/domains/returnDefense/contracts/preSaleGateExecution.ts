
export type PreSaleGateStage =
  | "RETAIL_SOURCE_QUALITY"
  | "ACQUISITION_PROFIT_DEFENSE"
  | "SOURCE_RECOVERY_WINDOW"
  | "RECEIVING_IDENTITY"
  | "INVENTORY_INTEGRITY";

export interface GateExecutionJob {
  gate_execution_run_id: string;
  passport_id: string;
  gate_stage: PreSaleGateStage;
  claim_token: string;
  attempt_count: number;
  max_attempts: number;
}

export interface GateWorkerOptions {
  workerId: string;
  batchSize: number;
  leaseSeconds: number;
  heartbeatSeconds: number;
}
