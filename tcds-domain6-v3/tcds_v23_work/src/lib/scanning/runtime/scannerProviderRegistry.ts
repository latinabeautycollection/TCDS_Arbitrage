import type { WarehouseScannerProvider } from '../contracts/WarehouseScannerProvider';

export type ScannerProviderFactory = () => WarehouseScannerProvider;

const registry = new Map<string, ScannerProviderFactory>();

export function registerScannerProvider(
  providerId: string,
  factory: ScannerProviderFactory,
  options: { replace?: boolean } = {},
): void {
  const normalized = providerId.trim().toLowerCase();
  if (!normalized) throw new Error('Scanner provider id is required.');
  if (registry.has(normalized) && !options.replace) {
    throw new Error(`Scanner provider already registered: ${normalized}`);
  }
  registry.set(normalized, factory);
}

export function unregisterScannerProvider(providerId: string): void {
  registry.delete(providerId.trim().toLowerCase());
}

export function hasScannerProvider(providerId: string): boolean {
  return registry.has(providerId.trim().toLowerCase());
}

export function createRegisteredScannerProvider(providerId: string): WarehouseScannerProvider {
  const normalized = providerId.trim().toLowerCase();
  const factory = registry.get(normalized);
  if (!factory) throw new Error(`Unsupported scanner provider: ${normalized}`);
  const provider = factory();
  if (provider.providerId !== normalized) {
    throw new Error(
      `Scanner provider factory contract violation: requested=${normalized}, returned=${provider.providerId}`,
    );
  }
  return provider;
}

export function resetScannerProviderRegistryForTests(): void {
  registry.clear();
}
