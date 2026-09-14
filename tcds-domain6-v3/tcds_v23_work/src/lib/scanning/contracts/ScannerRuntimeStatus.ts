export type ScannerRuntimePhase =
  | 'UNINITIALIZED'
  | 'CHECKING_CAPABILITIES'
  | 'LOADING'
  | 'INITIALIZING'
  | 'READY'
  | 'DEGRADED'
  | 'BLOCKED'
  | 'FAILED'
  | 'DISPOSING'
  | 'DISPOSED';

export type ScannerRuntimeBlockingReason =
  | 'NONE'
  | 'PROVIDER_DISABLED'
  | 'UNSUPPORTED_BROWSER'
  | 'WEBASSEMBLY_UNAVAILABLE'
  | 'WEB_WORKERS_UNAVAILABLE'
  | 'BLOB_UNAVAILABLE'
  | 'OBJECT_URL_UNAVAILABLE'
  | 'RUNTIME_ASSETS_UNAVAILABLE'
  | 'RUNTIME_VERSION_MISMATCH'
  | 'LICENSE_CONFIGURATION_MISSING'
  | 'LICENSE_REJECTED'
  | 'SDK_INITIALIZATION_FAILED'
  | 'SDK_CONTEXT_INVALID'
  | 'SECURE_CONTEXT_REQUIRED'
  | 'UNKNOWN';

export interface ScannerRuntimeStatus {
  phase: ScannerRuntimePhase;
  ready: boolean;
  degraded: boolean;
  blocked: boolean;
  blockingReason: ScannerRuntimeBlockingReason;
  provider: string;
  providerVersion?: string;
  runtimeAssetVersion?: string;
  progressPercentage?: number;
  loadedBytes?: number;
  message?: string;
  initializedAt?: string;
  initializationDurationMs?: number;
  providerStatusCode?: number;
  providerStatusValid?: boolean;
  providerStatusCategory?: string;
  degradationReasons?: string[];
  lastChangedAt: string;
}
