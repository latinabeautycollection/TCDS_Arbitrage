import { describe, expect, it } from 'vitest';
import type { WarehouseScannerProvider } from '../../src/lib/scanning/contracts/WarehouseScannerProvider';
import { TestScannerProvider } from './TestScannerProvider';

async function certify(provider: WarehouseScannerProvider) {
  await provider.initialize();
  const status = provider.getStatus();

  expect(status.provider).toBeTruthy();
  expect(provider.getCapabilities().supported).toBeTypeOf('boolean');
  expect(provider.getCapabilities().degraded).toBeTypeOf('boolean');
  expect(provider.getMetadata().providerId).toBe(provider.providerId);

  const unsubscribe = provider.subscribe(() => undefined);
  expect(unsubscribe).toBeTypeOf('function');
  unsubscribe();

  await provider.dispose();
}

describe('WarehouseScannerProvider contract', () => {
  it('is provider-neutral and replaceable', async () => {
    await certify(new TestScannerProvider());
  });
});
