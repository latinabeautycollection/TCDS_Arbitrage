import type { WarehouseScannerProvider } from '../contracts/WarehouseScannerProvider';
import { createRegisteredScannerProvider } from './scannerProviderRegistry';
import { registerBuiltInScannerProviders } from './registerBuiltInScannerProviders';

export function createWarehouseScannerProvider(
  providerId = String(import.meta.env.VITE_SCANNER_PROVIDER ?? 'scandit'),
): WarehouseScannerProvider {
  registerBuiltInScannerProviders();
  return createRegisteredScannerProvider(providerId);
}
