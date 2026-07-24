export type PutAwaySessionStatus =
  | 'LOADING' | 'READY' | 'ITEM_SCAN_REQUIRED' | 'LOCATION_SCAN_REQUIRED'
  | 'VALIDATING' | 'SYNC_PENDING' | 'EXCEPTION_REQUIRED' | 'REVIEW_REQUIRED'
  | 'OVERRIDE_PENDING' | 'TAKEOVER_PENDING' | 'COMMITTING' | 'COMPLETED'
  | 'BLOCKED' | 'EXPIRED' | 'ABANDONED';

export type LocationSuitability = 'RECOMMENDED' | 'ALTERNATIVE' | 'RESTRICTED';
export type ReadinessState = 'READY' | 'WARNING' | 'BLOCKED' | 'UNKNOWN';
export type OverrideLevel = 'MANAGER' | 'SUPERVISOR' | 'EXECUTIVE';
export type OfflineOperationType = 'ITEM_SCAN' | 'LOCATION_SCAN' | 'EXCEPTION' | 'SELECTION';

export interface PutAwayItemSummary {
  itemId: string;
  internalBarcode: string;
  title: string;
  brand?: string;
  model?: string;
  condition: string;
  actualWeightOz?: number;
  dimensions?: { lengthIn?: number; widthIn?: number; heightIn?: number };
  category?: string;
  containsBattery: boolean;
  fragile: boolean;
  hazardFlags: string[];
  securityClass?: string;
  verificationStatus: string;
  photoStatus: string;
  activeHoldCount: number;
  multiPiece?: { pieceCount: number; verifiedPieceCount: number };
}

export interface CapacitySnapshot {
  capacityUnits?: number;
  committedUnits: number;
  reservedUnits: number;
  availableUnits?: number;
  maxWeightOz?: number;
  committedWeightOz: number;
  reservedWeightOz: number;
  availableWeightOz?: number;
  reconciledAt: string;
}

export interface LocationRecommendation {
  recommendationId: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  suitability: LocationSuitability;
  confidence: number;
  capacity: CapacitySnapshot;
  walkingDistanceFeet?: number;
  pickOptimizationScore?: number;
  congestionScore?: number;
  zone?: string;
  reasons: string[];
  warnings: string[];
  expiresAt: string;
  reservationToken?: string;
  modelVersion?: string;
  featureSnapshotId?: string;
}

export interface PutAwayReadiness {
  overall: ReadinessState;
  api: ReadinessState;
  database: ReadinessState;
  scanner: ReadinessState;
  station: ReadinessState;
  network: ReadinessState;
  recommendationEngine: ReadinessState;
  auditPipeline: ReadinessState;
  reasons: string[];
}

export interface PutAwayGate {
  gatePassed: boolean;
  checks: Array<{ code: string; passed: boolean; blocking: boolean; message: string }>;
  evaluatedAt: string;
}

export interface PutAwaySession {
  putAwaySessionId: string;
  workflowToken: string;
  status: PutAwaySessionStatus;
  item: PutAwayItemSummary;
  facility: { facilityId: string; facilityCode: string; facilityName: string };
  station: { stationId: string; stationCode: string; stationName: string };
  operator: { employeeNumber: string; displayName: string };
  readiness: PutAwayReadiness;
  recommendation: LocationRecommendation | null;
  alternatives: LocationRecommendation[];
  scannedItemBarcode?: string;
  scannedLocationBarcode?: string;
  validationMessages: string[];
  exception?: {
    exceptionId?: string;
    exceptionType: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    blocking: boolean;
    message: string;
    managerReviewRequired: boolean;
  };
  gate?: PutAwayGate;
  rowVersion: number;
  claimExpiresAt: string;
  claimOwnerDeviceId?: string;
  claimOwnerDisplayName?: string;
  takeoverRequested?: boolean;
  offlineQueueCount: number;
}

export interface PutAwayCompletion {
  completed: true;
  itemId: string;
  locationId: string;
  locationCode: string;
  movementId: string;
  inventoryStatus: string;
  completedAt: string;
  eventIds: { domainEventId: string; outboxEventId: string; activityEventId: string };
  nextWorkflow: { route: string; workflowToken: string };
}

export interface ApiErrorPayload {
  code?: string;
  message?: string;
  supportReference?: string;
  retryAfterSeconds?: number;
  currentRowVersion?: number;
}

export interface OfflinePutAwayOperation {
  operationId: string;
  sessionId: string;
  type: OfflineOperationType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  clientOccurredAt: string;
  status: 'QUEUED' | 'SYNCING' | 'FAILED';
  attemptCount: number;
  lastError?: string;
}
