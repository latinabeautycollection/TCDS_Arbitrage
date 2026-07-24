export type ShotState =
  | 'NOT_STARTED' | 'CAPTURED_LOCAL' | 'PREFLIGHT_FAILED' | 'QUEUED_OFFLINE'
  | 'UPLOAD_AUTHORIZING' | 'UPLOADING' | 'UPLOAD_RETRYING' | 'REMOTE_CONFIRMED'
  | 'COMMITTING' | 'ASSESSMENT_QUEUED' | 'ASSESSMENT_PROCESSING' | 'ACCEPTED'
  | 'RETAKE_REQUIRED' | 'REVIEW_REQUIRED' | 'OVERRIDDEN' | 'REJECTED' | 'VOIDED';

export type SessionState =
  | 'OPEN' | 'CAPTURING' | 'SYNC_PENDING' | 'ASSESSMENT_PENDING' | 'REVIEW_REQUIRED'
  | 'OVERRIDE_PENDING' | 'COMPLETION_CHECK' | 'COMPLETED' | 'BLOCKED' | 'ABANDONED';

export type RequirementClass = 'MANDATORY' | 'CONDITIONAL' | 'OPTIONAL';

export interface PhotoRequirement {
  requirementId: string;
  shotCode: string;
  displayName: string;
  instructions: string;
  sequenceNo: number;
  requirementClass: RequirementClass;
  minimumWidth: number;
  minimumHeight: number;
  orientation: 'PORTRAIT' | 'LANDSCAPE' | 'ANY';
  allowsMultiple: boolean;
  requiresReadableText: boolean;
  requiresBarcodeReadable: boolean;
  requiresSerialReadable: boolean;
  backgroundPolicy: 'STANDARD' | 'WHITE' | 'CONTEXTUAL' | 'NONE';
  state: ShotState;
  rejectionReasons: string[];
  localQueueId?: string;
  mediaAssetId?: string;
  uploadProgress?: number;
  localCopyRetained?: boolean;
  remoteConfirmed?: boolean;
  hashVerified?: boolean;
  databaseCommitted?: boolean;
  evidenceCommitted?: boolean;
  assessmentAccepted?: boolean;
  overridden?: boolean;
}

export interface PhotoSession {
  photoSessionId: string;
  workflowToken: string;
  itemId: string;
  internalBarcode: string;
  productTitle: string;
  profileCode: string;
  profileVersion: number;
  status: SessionState;
  acceptedRequiredShots: number;
  requiredShots: number;
  stationCode: string;
  facilityCode: string;
  claim: { deviceId: string; expiresAt: string; active: boolean };
  requirements: PhotoRequirement[];
  connectivity: {
    online: boolean;
    r2PrimaryAvailable: boolean;
    apiFallbackAvailable: boolean;
    assessmentAvailable: boolean;
    databaseAvailable: boolean;
  };
  overridePolicy: {
    managerEnabled: boolean;
    executiveEnabled: boolean;
    prohibitedReasons: string[];
  };
}

export interface CompletionGate {
  gatePassed: boolean;
  status: SessionState;
  acceptedRequiredShots: number;
  requiredShots: number;
  blockingIssues: string[];
  overrideApplied: boolean;
  nextWorkflow?: { route: '/verify'; workflowToken: string };
}
