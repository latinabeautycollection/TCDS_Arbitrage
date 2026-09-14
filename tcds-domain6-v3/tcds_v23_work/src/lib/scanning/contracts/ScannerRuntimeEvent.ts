import type { ScannerRuntimeStatus } from './ScannerRuntimeStatus';

export type ScannerRuntimeEventType =
  | 'STATUS_CHANGED'
  | 'LOAD_PROGRESS'
  | 'PROVIDER_STATUS'
  | 'INITIALIZED'
  | 'RECOVERED'
  | 'DEGRADED'
  | 'BLOCKED'
  | 'ERROR'
  | 'DISPOSED';

export interface ScannerRuntimeEvent {
  eventId: string;
  type: ScannerRuntimeEventType;
  provider: string;
  occurredAt: string;
  status: ScannerRuntimeStatus;
  details?: Readonly<Record<string, unknown>>;
}

export type ScannerRuntimeListener = (event: ScannerRuntimeEvent) => void;
