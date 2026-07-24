export type HealthState = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
export type Severity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'EMERGENCY';
export type ExceptionStatus = 'OPEN' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'CONTAINED' | 'REVIEW_REQUIRED' | 'RESOLVED' | 'CLOSED';
export type WorkflowDomain = 'AUTH' | 'RECEIVING' | 'PHOTOS' | 'VERIFICATION' | 'PUTAWAY' | 'INVENTORY' | 'PICKING' | 'PACK_SHIP' | 'RETURNS' | 'DEVICE' | 'SYNC' | 'SECURITY' | 'CLAIMS' | 'WORKFORCE' | 'UNKNOWN';
export type ConsoleSection = 'OPERATIONS' | 'WORKFLOWS' | 'PACKAGES' | 'EXCEPTIONS' | 'APPROVALS' | 'HEALTH' | 'DEVICES' | 'SYNC' | 'SECURITY' | 'ANALYTICS' | 'WORKFORCE' | 'SLA';

export interface ReadinessService {
  key: string;
  label: string;
  state: HealthState;
  detail: string;
  lastCheckedAt: string;
  blocking: boolean;
  latencyMs?: number;
  prediction?: string;
}

export interface SupervisorMessage {
  code: string;
  severity: Severity;
  blocking: boolean;
  retryable: boolean;
  title: string;
  explanation: string;
  nextStep: string;
  supportReference?: string;
  destination?: ConsoleSection;
  entityReference?: string;
  expiresAt?: string;
}

export interface ExceptionRecord {
  exceptionId: string;
  exceptionNumber: string;
  domain: WorkflowDomain;
  severity: Severity;
  status: ExceptionStatus;
  title: string;
  summary: string;
  facilityCode: string;
  stationCode?: string;
  employeeName?: string;
  entityReference?: string;
  openedAt: string;
  slaDueAt?: string;
  slaState?: 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'NO_SLA';
  ownerName?: string;
  blocking: boolean;
  contained?: boolean;
  allowedActions: string[];
}

export interface ApprovalRequest {
  approvalId: string;
  approvalType: 'OVERRIDE' | 'TAKEOVER' | 'REPRINT' | 'MANUAL_ADMISSION' | 'DISPOSITION' | 'PARTIAL_PICK' | 'SHIPPING_RISK' | 'SHIFT_HANDOFF' | 'WORKFORCE_REALLOCATION';
  domain: WorkflowDomain;
  title: string;
  requestedBy: string;
  requestedAt: string;
  riskLevel: Severity;
  evidenceComplete: boolean;
  decisionStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REVOKED';
  prohibitedReasons: string[];
  secondPersonRequired?: boolean;
  expiresAt?: string;
  rowVersion?: number;
}

export interface DeviceStatus {
  deviceId: string;
  deviceType: 'GATEWAY' | 'PRINTER' | 'SCANNER' | 'SCALE' | 'IPHONE' | 'WORKSTATION' | 'NETWORK' | 'CAMERA';
  name: string;
  state: HealthState;
  stationCode?: string;
  lastSeenAt: string;
  firmware?: string;
  issue?: string;
  batteryPercent?: number;
  signalQuality?: string;
  supplyPercent?: number;
  supplyRemaining?: number;
  lastActivityAt?: string;
  droppedEvents?: number;
  calibrationState?: string;
  calibrationDueAt?: string;
  predictiveAlert?: string;
}

export interface SyncQueueSummary {
  queued: number;
  processing: number;
  failed: number;
  deadLetter: number;
  oldestQueuedAt?: string;
}

export interface OperationMetric {
  domain: WorkflowDomain;
  label: string;
  active: number;
  waiting: number;
  completedToday: number;
  blocked: number;
  attentionRequired: number;
}

export interface LifecycleStage {
  key: string;
  label: string;
  count: number;
  averageAgeMinutes: number;
  oldestAgeMinutes: number;
  health: 'HEALTHY' | 'AT_RISK' | 'BEHIND' | 'BLOCKED';
}

export interface SlaMetric {
  workflow: WorkflowDomain;
  label: string;
  targetMinutes: number;
  averageMinutes: number;
  p95Minutes: number;
  breachedCount: number;
  atRiskCount: number;
}

export interface WorkforceStatus {
  employeeId: string;
  employeeName: string;
  role: string;
  currentWorkflow?: WorkflowDomain;
  currentStation?: string;
  activeWorkCount: number;
  completedToday: number;
  state: 'ACTIVE' | 'IDLE' | 'BREAK' | 'OFFLINE' | 'ATTENTION';
  lastSeenAt: string;
}

export interface WarehouseZoneStatus {
  zoneCode: string;
  zoneName: string;
  occupiedStations: number;
  totalStations: number;
  activeWork: number;
  blockedWork: number;
  state: 'HEALTHY' | 'BUSY' | 'CONGESTED' | 'BLOCKED';
}

export interface PackageLifecycleRecord {
  packageId: string;
  packageReference: string;
  itemReference?: string;
  orderReference?: string;
  currentStage: string;
  currentOwner?: string;
  currentStation?: string;
  lastEventAt: string;
  ageMinutes: number;
  slaState: 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
  nextExpectedStage?: string;
  missingWatch?: boolean;
  timeline: Array<{ stage: string; occurredAt?: string; status: 'COMPLETE' | 'CURRENT' | 'PENDING' | 'BLOCKED' }>;
}

export interface AiInsight {
  insightId: string;
  severity: Severity;
  category: 'BOTTLENECK' | 'WORKFORCE' | 'DEVICE' | 'CARRIER' | 'INVENTORY' | 'RISK' | 'COST' | 'SLA';
  title: string;
  recommendation: string;
  reason: string;
  expectedImpact?: string;
  confidence: number;
  requiresApproval: boolean;
  destination?: ConsoleSection;
}

export interface FinancialSnapshot {
  shipmentsToday: number;
  revenueTodayUsd: number;
  shippingCostTodayUsd: number;
  inventoryValueUsd: number;
  pendingClaimsUsd: number;
  potentialLossUsd: number;
  recoveredValueUsd: number;
  returnsToday: number;
  damagedToday: number;
  currency: string;
}

export interface ShiftHandoff {
  handoffId?: string;
  shiftName: string;
  outgoingSupervisor?: string;
  incomingSupervisor?: string;
  status: 'NOT_STARTED' | 'DRAFT' | 'READY' | 'ACKNOWLEDGED';
  completedSummary: Record<string, number>;
  pendingSummary: Record<string, number>;
  criticalIssues: number;
  deviceSummary: string;
  notes?: string;
  createdAt?: string;
  acknowledgedAt?: string;
}

export interface SupervisorConsoleResponse {
  facilityCode: string;
  stationCode: string;
  employeeName: string;
  role: string;
  generatedAt: string;
  rowVersion: number;
  summary: {
    openExceptions: number;
    criticalExceptions: number;
    pendingApprovals: number;
    offlineDevices: number;
    failedSyncOperations: number;
    activeWorkflowClaims: number;
    packagesAtRisk: number;
    slaBreaches: number;
    workforceOnline: number;
    shipmentsAtRisk: number;
  };
  operations: OperationMetric[];
  lifecycle: LifecycleStage[];
  slaMetrics: SlaMetric[];
  workforce: WorkforceStatus[];
  zones: WarehouseZoneStatus[];
  packageWatch: PackageLifecycleRecord[];
  insights: AiInsight[];
  financials: FinancialSnapshot;
  shiftHandoff: ShiftHandoff;
  readiness: ReadinessService[];
  exceptions: ExceptionRecord[];
  approvals: ApprovalRequest[];
  devices: DeviceStatus[];
  sync: SyncQueueSummary;
  messages: SupervisorMessage[];
  permissions: {
    canResolveExceptions: boolean;
    canApproveOverrides: boolean;
    canApproveExecutiveOverrides: boolean;
    canApproveTakeovers: boolean;
    canRetrySync: boolean;
    canManageDevices: boolean;
    canViewSecurityEvents: boolean;
    canViewFinancials: boolean;
    canReassignWorkforce: boolean;
    canCreateShiftHandoff: boolean;
  };
}
