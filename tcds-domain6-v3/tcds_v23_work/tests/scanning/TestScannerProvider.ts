import type { WarehouseScannerProvider } from '../../src/lib/scanning/contracts/WarehouseScannerProvider';
import type { ScannerRuntimeListener } from '../../src/lib/scanning/contracts/ScannerRuntimeEvent';

export class TestScannerProvider implements WarehouseScannerProvider {
  readonly providerId = 'test';

  async initialize(): Promise<void> {}
  async dispose(): Promise<void> {}

  getStatus() {
    return {
      phase: 'READY',
      ready: true,
      degraded: false,
      blocked: false,
      blockingReason: 'NONE',
      provider: 'test',
      providerVersion: '1.0.0',
      runtimeAssetVersion: '1.0.0',
      degradationReasons: [],
      lastChangedAt: new Date().toISOString(),
    } as const;
  }

  getCapabilities() {
    return {
      supported: true,
      degraded: false,
      secureContext: true,
      webAssembly: true,
      webWorkers: true,
      blob: true,
      objectUrl: true,
      mediaDevices: true,
      getUserMedia: true,
      sharedArrayBuffer: true,
      offscreenCanvas: true,
      webGL: true,
      userAgent: 'TEST',
      reasons: [],
      degradedReasons: [],
    };
  }

  getMetadata() {
    return {
      providerId: 'test',
      providerName: 'Test Provider',
      providerVersion: '1.0.0',
      runtimeAssetVersion: '1.0.0',
      implementationVersion: '1.0.0',
      capabilities: ['RUNTIME'] as const,
    };
  }

  subscribe(_listener: ScannerRuntimeListener): () => void {
    return () => {};
  }
}
