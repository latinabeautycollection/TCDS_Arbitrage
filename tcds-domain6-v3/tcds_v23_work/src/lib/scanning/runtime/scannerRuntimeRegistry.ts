import type { WarehouseScannerProvider } from '../contracts/WarehouseScannerProvider';
import { createWarehouseScannerProvider } from './scannerProviderFactory';

let provider: WarehouseScannerProvider | null = null;
export function getScannerRuntime(): WarehouseScannerProvider { return provider ??= createWarehouseScannerProvider(); }
export async function disposeScannerRuntime(): Promise<void> { if (!provider) return; await provider.dispose(); provider = null; }
