export type ReadinessState = 'READY' | 'DEGRADED' | 'OFFLINE' | 'BLOCKED';
export type PickTaskStatus = 'CREATED' | 'READY' | 'CLAIMED' | 'IN_PROGRESS' | 'EXCEPTION' | 'REVIEW_REQUIRED' | 'PARTIALLY_PICKED' | 'PICKED' | 'HANDED_TO_PACKING' | 'CANCELLED' | 'ABANDONED';
export type PickLineStatus = 'PENDING' | 'LOCATION_CONFIRMED' | 'ITEM_CONFIRMED' | 'CONDITION_CONFIRMED' | 'STAGED' | 'COMPLETED' | 'SHORT_PICK' | 'BLOCKED' | 'CANCELLED';
export type PickStep = 'TRAVEL' | 'SCAN_LOCATION' | 'SCAN_ITEM' | 'CONFIRM_CONDITION' | 'SCAN_DESTINATION' | 'COMPLETE';
export type ExceptionType = 'ITEM_NOT_FOUND' | 'WRONG_ITEM' | 'WRONG_LOCATION' | 'DAMAGE_FOUND' | 'PACKAGING_ISSUE' | 'IDENTITY_CONCERN' | 'RESERVATION_CHANGED' | 'ORDER_CANCELLED' | 'SCANNER_FAILURE' | 'UNKNOWN';

export interface PickReadiness {
  overall: ReadinessState;
  api: ReadinessState;
  database: ReadinessState;
  scanner: ReadinessState;
  station: ReadinessState;
  network: ReadinessState;
  routeOptimizer: ReadinessState;
  dataFreshAt: string;
}

export interface PickItemInstruction {
  lineId: string;
  itemId: string;
  internalBarcode: string;
  title: string;
  locationCode: string;
  serialSuffix?: string;
  quantity: number;
  condition: string;
  fragile?: boolean;
  highValue?: boolean;
  batteryRestricted?: boolean;
  status: PickLineStatus;
}

export interface PickTask {
  taskId: string;
  taskNumber: string;
  orderNumber: string;
  status: PickTaskStatus;
  mode: 'SINGLE_ORDER' | 'SMALL_BATCH';
  priority: 'STANDARD' | 'HIGH' | 'EXPEDITE';
  progressCurrent: number;
  progressTotal: number;
  packDestinationCode: string;
  employeeDisplayName: string;
  facilityCode: string;
  claimExpiresAt: string;
  rowVersion: number;
  claimToken: string;
  activeStep: PickStep;
  current: PickItemInstruction;
  next?: PickItemInstruction;
  readiness: PickReadiness;
  queuedObservations: number;
  completionGatePassed: boolean;
  blockingReasons: string[];
}

export interface ScanResult {
  accepted: boolean;
  code: string;
  message: string;
  task: PickTask;
}

export interface CompletionResult {
  committed: boolean;
  pickTaskStatus: PickTaskStatus;
  packingTaskId?: string;
  nextTaskId?: string;
  message: string;
}
