export type ActorType = 'user' | 'worker' | 'system' | 'api' | 'service_account';
export type IntakeGateResult = 'PASSED' | 'BLOCKED' | 'SUPERVISOR_REVIEW' | 'QUARANTINED';
export type AdjudicationGateResult = 'APPROVED' | 'BLOCKED' | 'SUPERVISOR_REVIEW' | 'QUARANTINED';

export interface ReturnPrincipal {
  readonly tenantKey: string;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly actorName?: string;
  readonly warehouseUserId: string;
  readonly warehouseEmployeeId: string;
  readonly warehouseAuthSessionId: string;
  readonly warehouseDeviceSessionId: string;
  readonly facilityId: string;
  readonly stationId?: string;
  readonly deviceId: string;
  readonly assuranceLevel: 'AAL1' | 'AAL2';
  readonly permissions: readonly string[];
}

export interface ProcessRunContext {
  readonly processRunId: string;
  readonly correlationId: string;
}
