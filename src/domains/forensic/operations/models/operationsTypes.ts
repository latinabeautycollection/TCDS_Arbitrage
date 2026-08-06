export type Uuid = string;
export interface ForensicPrincipal {
  readonly tenantKey: string;
  readonly userId: Uuid;
  readonly authSessionId: Uuid;
  readonly assuranceLevel: 'AAL1' | 'AAL2';
  readonly permissions: readonly string[];
}
export type AlertAction = 'ACKNOWLEDGE'|'ASSIGN'|'ESCALATE'|'CLOSE'|'REOPEN';
export interface ReportRequest {
  readonly reportDate: string;
  readonly asOfAt: string;
  readonly schemaVersion: string;
  readonly idempotencyKey: string;
}
