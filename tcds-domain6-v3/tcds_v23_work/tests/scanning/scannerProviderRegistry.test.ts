import { describe, expect, it, beforeEach } from 'vitest';
import {
  createRegisteredScannerProvider,
  registerScannerProvider,
  resetScannerProviderRegistryForTests,
} from '../../src/lib/scanning/runtime/scannerProviderRegistry';
import { TestScannerProvider } from './TestScannerProvider';

describe('scannerProviderRegistry', () => {
  beforeEach(() => resetScannerProviderRegistryForTests());

  it('supports provider replacement without Domain 6 changes', () => {
    registerScannerProvider('test', () => new TestScannerProvider());
    expect(createRegisteredScannerProvider('test').providerId).toBe('test');
  });

  it('rejects duplicate registration unless explicitly replaced', () => {
    registerScannerProvider('test', () => new TestScannerProvider());
    expect(() => registerScannerProvider('test', () => new TestScannerProvider())).toThrow();
  });

  it('rejects factories that violate provider identity', () => {
    registerScannerProvider('other', () => new TestScannerProvider());
    expect(() => createRegisteredScannerProvider('other')).toThrow(/contract violation/i);
  });
});
