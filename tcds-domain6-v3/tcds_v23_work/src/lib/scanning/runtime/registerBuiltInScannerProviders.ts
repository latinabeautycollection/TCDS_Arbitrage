import { ScanditScannerProvider } from '../providers/scandit';
import { hasScannerProvider, registerScannerProvider } from './scannerProviderRegistry';

export function registerBuiltInScannerProviders(): void {
  if (!hasScannerProvider('scandit')) {
    registerScannerProvider('scandit', () => new ScanditScannerProvider());
  }
}
