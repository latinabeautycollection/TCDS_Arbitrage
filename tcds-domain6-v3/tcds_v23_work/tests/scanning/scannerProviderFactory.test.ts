import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/scanning/providers/scandit', () => ({
  ScanditScannerProvider: class {
    readonly providerId = 'scandit';
    async initialize() {}
    async dispose() {}
    getStatus() {
      return {
        phase: 'READY', ready: true, degraded: false, blocked: false,
        blockingReason: 'NONE', provider: 'scandit',
        providerVersion: '8.5.2', runtimeAssetVersion: '8.5.2',
        degradationReasons: [], lastChangedAt: new Date().toISOString(),
      };
    }
    getCapabilities() {
      return {
        supported: true, degraded: false, secureContext: true, webAssembly: true,
        webWorkers: true, blob: true, objectUrl: true, mediaDevices: true,
        getUserMedia: true, sharedArrayBuffer: true, offscreenCanvas: true,
        webGL: true, userAgent: 'TEST', reasons: [], degradedReasons: [],
      };
    }
    getMetadata() {
      return {
        providerId: 'scandit', providerName: 'Scandit', providerVersion: '8.5.2',
        runtimeAssetVersion: '8.5.2', implementationVersion: '6.2A.2',
        capabilities: ['RUNTIME'],
      };
    }
    subscribe() { return () => {}; }
  },
}));

import { createWarehouseScannerProvider } from '../../src/lib/scanning/runtime/scannerProviderFactory';
import { resetScannerProviderRegistryForTests } from '../../src/lib/scanning/runtime/scannerProviderRegistry';

describe('scannerProviderFactory', () => {
  beforeEach(() => resetScannerProviderRegistryForTests());

  it('creates the configured built-in provider', () => {
    expect(createWarehouseScannerProvider('scandit').providerId).toBe('scandit');
  });

  it('rejects unknown providers', () => {
    expect(() => createWarehouseScannerProvider('unknown')).toThrow(/unsupported/i);
  });
});
