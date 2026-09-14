import type { ScannerCapabilityReport } from './ScannerCapabilityReport';
import type { ScannerProviderMetadata } from './ScannerProviderMetadata';
import type { ScannerRuntimeListener } from './ScannerRuntimeEvent';
import type { ScannerRuntimeStatus } from './ScannerRuntimeStatus';

/**
 * Domain 6.2A runtime-only provider contract.
 * Camera/capture/profile methods are intentionally prohibited until later slices.
 */
export interface WarehouseScannerProvider {
  readonly providerId: string;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  getStatus(): ScannerRuntimeStatus;
  getCapabilities(): ScannerCapabilityReport;
  getMetadata(): ScannerProviderMetadata;
  subscribe(listener: ScannerRuntimeListener): () => void;
}
