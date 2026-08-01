export type WarehouseWorkflow =
  | 'RECEIVING' | 'IDENTITY' | 'TESTING'
  | 'PHOTO_STATION' | 'PACKING' | 'RETURN';

export interface WarehouseEvidenceSession {
  warehouseEvidenceSessionId: string;
  chainId: string;
  tenantKey: string;
  workflowType: WarehouseWorkflow;
  status: string;
  continuityStatus: string;
  openedAt: string;
  completedAt: string | null;
}

export interface GateEvaluation {
  warehouseGateEvaluationId: string;
  result: 'PASSED' | 'BLOCKED' | 'SUPERVISOR_REVIEW';
  blockers: unknown[];
  evidenceSnapshot: Record<string, unknown>;
}
