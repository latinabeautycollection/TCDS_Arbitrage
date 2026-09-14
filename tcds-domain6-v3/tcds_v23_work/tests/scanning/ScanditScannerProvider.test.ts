import { beforeEach, describe, expect, it, vi } from 'vitest';

const scanditMock = vi.hoisted(() => {
  type LoadingSubscriber = (info: unknown) => void;

  const state = {
    listener: null as any,
    disposeCalls: 0,
    forLicenseKeyCalls: 0,
    options: null as any,
    contextCreationError: null as unknown,
    loadingSubscribers: new Set<LoadingSubscriber>(),
    subscribeCalls: [] as LoadingSubscriber[],
    unsubscribeCalls: [] as LoadingSubscriber[],
    subscriberCountsAtContextCreation: [] as number[],
  };

  const context = {
    addListener(listener: any) {
      state.listener = listener;
      listener.didStartObservingContext?.(context);
    },
    removeListener(listener: any) {
      if (state.listener === listener) state.listener = null;
    },
    async dispose() {
      state.disposeCalls += 1;
    },
  };

  // Mirrors the real Scandit 8.5.2 LoadingStatus: subscribers are kept in a Set,
  // subscribe() and unsubscribe() both return void, and removal needs the same function.
  const loadingStatus = {
    subscribe(subscriber: LoadingSubscriber): void {
      state.subscribeCalls.push(subscriber);
      state.loadingSubscribers.add(subscriber);
    },
    unsubscribe(subscriber: LoadingSubscriber): void {
      state.unsubscribeCalls.push(subscriber);
      state.loadingSubscribers.delete(subscriber);
    },
    notify(info: unknown): void {
      for (const subscriber of state.loadingSubscribers) subscriber(info);
    },
  };

  return { state, context, loadingStatus };
});

vi.mock('@scandit/web-datacapture-core', () => ({
  DataCaptureContext: {
    forLicenseKey: vi.fn(async (_licenseKey: string, options: unknown) => {
      scanditMock.state.forLicenseKeyCalls += 1;
      scanditMock.state.options = options;
      scanditMock.state.subscriberCountsAtContextCreation.push(scanditMock.state.loadingSubscribers.size);
      scanditMock.loadingStatus.notify({ percentage: null, loadedBytes: 1024, privateUri: '' });
      if (scanditMock.state.contextCreationError) throw scanditMock.state.contextCreationError;
      return scanditMock.context;
    }),
  },
  loadingStatus: scanditMock.loadingStatus,
  BrowserHelper: {
    checkBrowserCompatibility: vi.fn(() => ({
      fullSupport: true,
      scannerSupport: true,
      missingFeatures: [],
    })),
  },
  Logger: {
    Level: {
      Debug: 'DEBUG',
      Info: 'INFO',
      Warn: 'WARN',
      Error: 'ERROR',
      Quiet: 'QUIET',
    },
  },
}));

vi.mock('@scandit/web-datacapture-barcode', () => ({
  barcodeCaptureLoader: vi.fn(() => ({ moduleName: 'barcode' })),
}));

import { ScannerProviderError } from '../../src/lib/scanning/contracts/ScannerProviderError';
import { ScanditScannerProvider } from '../../src/lib/scanning/providers/scandit/ScanditScannerProvider';

function installSupportedBrowser({ webGL = true, offscreenCanvas = true } = {}) {
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal('Blob', class {});
  vi.stubGlobal('URL', { createObjectURL: vi.fn() });
  vi.stubGlobal('SharedArrayBuffer', class {});
  if (offscreenCanvas) vi.stubGlobal('OffscreenCanvas', class {});
  else vi.stubGlobal('OffscreenCanvas', undefined);

  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn() },
    hardwareConcurrency: 8,
    userAgent: 'TEST',
  });

  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => (webGL ? {} : null),
    }),
  });
}

describe('ScanditScannerProvider', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    installSupportedBrowser();
    vi.stubEnv('VITE_SCANDIT_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_SCANDIT_LICENSE_KEY', 'test-license');
    vi.stubEnv('VITE_SCANDIT_LIBRARY_BASE', '/scandit');
    vi.stubEnv('VITE_SCANDIT_LOG_LEVEL', 'warn');
    scanditMock.state.listener = null;
    scanditMock.state.disposeCalls = 0;
    scanditMock.state.forLicenseKeyCalls = 0;
    scanditMock.state.options = null;
    scanditMock.state.contextCreationError = null;
    scanditMock.state.loadingSubscribers.clear();
    scanditMock.state.subscribeCalls = [];
    scanditMock.state.unsubscribeCalls = [];
    scanditMock.state.subscriberCountsAtContextCreation = [];
  });

  it('single-flights concurrent initialization', async () => {
    const provider = new ScanditScannerProvider();
    await Promise.all([provider.initialize(), provider.initialize(), provider.initialize()]);
    expect(scanditMock.state.forLicenseKeyCalls).toBe(1);
    expect(provider.getStatus().ready).toBe(true);
  });

  it('passes configured log level into Scandit context creation', async () => {
    const provider = new ScanditScannerProvider();
    await provider.initialize();
    expect(scanditMock.state.options?.logLevel).toBe('WARN');
  });

  it('makes metadata available without a license key', () => {
    vi.stubEnv('VITE_SCANDIT_LICENSE_KEY', '');
    const provider = new ScanditScannerProvider();
    expect(provider.getMetadata().providerId).toBe('scandit');
    expect(provider.getMetadata().libraryLocation).toContain('/scandit/');
  });

  it('moves to BLOCKED on structured license status', async () => {
    const provider = new ScanditScannerProvider();
    await provider.initialize();

    scanditMock.state.listener?.didChangeStatus?.(scanditMock.context, {
      code: 13,
      isValid: false,
      message: 'License expired',
    });

    const status = provider.getStatus();
    expect(status.phase).toBe('BLOCKED');
    expect(status.providerStatusCode).toBe(13);
    expect(status.blockingReason).toBe('LICENSE_REJECTED');
  });

  it('recovers from invalid provider status when Scandit returns Success', async () => {
    const provider = new ScanditScannerProvider();
    await provider.initialize();

    scanditMock.state.listener?.didChangeStatus?.(scanditMock.context, {
      code: 6,
      isValid: false,
      message: 'network unavailable',
    });
    expect(provider.getStatus().blocked).toBe(true);

    scanditMock.state.listener?.didChangeStatus?.(scanditMock.context, {
      code: 1,
      isValid: true,
      message: '',
    });
    expect(provider.getStatus().ready).toBe(true);
    expect(provider.getStatus().blocked).toBe(false);
  });

  it('uses DEGRADED for optional acceleration deficiencies', async () => {
    vi.unstubAllGlobals();
    installSupportedBrowser({ webGL: false, offscreenCanvas: false });
    const provider = new ScanditScannerProvider();
    await provider.initialize();
    expect(provider.getStatus().phase).toBe('DEGRADED');
    expect(provider.getStatus().degradationReasons).toContain('WEBGL_UNAVAILABLE');
  });

  it('disposes context and listener idempotently', async () => {
    const provider = new ScanditScannerProvider();
    await provider.initialize();
    await provider.dispose();
    await provider.dispose();
    expect(scanditMock.state.disposeCalls).toBe(1);
    expect(scanditMock.state.listener).toBeNull();
  });

  it('removes the Scandit loading subscriber with the same function after initialization', async () => {
    const provider = new ScanditScannerProvider();
    const events: Array<{ type: string; percentage?: number; loadedBytes?: number }> = [];
    provider.subscribe((event) => {
      events.push({
        type: event.type,
        percentage: event.status.progressPercentage,
        loadedBytes: event.status.loadedBytes,
      });
    });

    await provider.initialize();

    expect(scanditMock.state.subscribeCalls).toHaveLength(1);
    expect(scanditMock.state.unsubscribeCalls).toHaveLength(1);
    expect(scanditMock.state.unsubscribeCalls[0]).toBe(scanditMock.state.subscribeCalls[0]);
    expect(scanditMock.state.subscriberCountsAtContextCreation).toEqual([1]);
    expect(scanditMock.state.loadingSubscribers.size).toBe(0);
    expect(events).toContainEqual({ type: 'LOAD_PROGRESS', percentage: undefined, loadedBytes: 1024 });
  });

  it('does not stack loading subscribers across re-initialization', async () => {
    const provider = new ScanditScannerProvider();

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await provider.initialize();
      await provider.dispose();
    }
    await provider.initialize();

    expect(scanditMock.state.forLicenseKeyCalls).toBe(4);
    expect(scanditMock.state.subscriberCountsAtContextCreation).toEqual([1, 1, 1, 1]);
    expect(scanditMock.state.loadingSubscribers.size).toBe(0);
    expect(scanditMock.state.subscribeCalls).toHaveLength(4);
    expect(scanditMock.state.unsubscribeCalls).toHaveLength(4);
    scanditMock.state.subscribeCalls.forEach((subscriber, index) => {
      expect(scanditMock.state.unsubscribeCalls[index]).toBe(subscriber);
    });

    const eventsAfterReady: string[] = [];
    provider.subscribe((event) => eventsAfterReady.push(event.type));
    scanditMock.loadingStatus.notify({ percentage: 50, loadedBytes: 2048, privateUri: '' });

    expect(eventsAfterReady).toEqual([]);
    expect(provider.getStatus().phase).toBe('READY');
  });

  it('removes the loading subscriber and exposes no raw exception when initialization fails', async () => {
    const raw = new Error('Engine failed https://cdn.example.com/scandit/engine.wasm key=S3CR3TVALUE');
    scanditMock.state.contextCreationError = raw;
    const provider = new ScanditScannerProvider();

    const failure = await provider.initialize().then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(failure).toBeInstanceOf(ScannerProviderError);
    const providerError = failure as ScannerProviderError;
    expect(providerError.code).toBe('RUNTIME_ASSET_NOT_FOUND');
    expect(providerError.cause).not.toBe(raw);
    expect(providerError.cause).not.toBeInstanceOf(Error);
    expect(providerError.cause?.message).not.toContain('https://');
    expect(providerError.cause?.message).not.toContain('S3CR3TVALUE');
    expect(scanditMock.state.loadingSubscribers.size).toBe(0);
    expect(scanditMock.state.unsubscribeCalls).toHaveLength(1);
    expect(scanditMock.state.unsubscribeCalls[0]).toBe(scanditMock.state.subscribeCalls[0]);
  });

  it('does not stack loading subscribers when initialization is retried after a failure', async () => {
    scanditMock.state.contextCreationError = new Error('Engine failed');
    const provider = new ScanditScannerProvider();

    await expect(provider.initialize()).rejects.toBeInstanceOf(ScannerProviderError);
    expect(provider.getStatus().phase).toBe('FAILED');
    expect(scanditMock.state.loadingSubscribers.size).toBe(0);

    scanditMock.state.contextCreationError = null;
    await provider.initialize();

    expect(provider.getStatus().phase).toBe('READY');
    expect(scanditMock.state.subscriberCountsAtContextCreation).toEqual([1, 1]);
    expect(scanditMock.state.loadingSubscribers.size).toBe(0);
  });

  it('leaves no loading subscriber when a runtime listener throws during initialization', async () => {
    const provider = new ScanditScannerProvider();
    let throwOnPhase: string | null = 'INITIALIZING';
    provider.subscribe((event) => {
      if (event.status.phase === throwOnPhase) {
        throwOnPhase = null;
        throw new Error('runtime listener failure');
      }
    });

    await expect(provider.initialize()).rejects.toThrow('runtime listener failure');
    expect(scanditMock.state.loadingSubscribers.size).toBe(0);

    throwOnPhase = 'LOADING';
    await expect(provider.initialize()).rejects.toBeInstanceOf(ScannerProviderError);
    expect(scanditMock.state.loadingSubscribers.size).toBe(0);

    await provider.initialize();
    expect(provider.getStatus().phase).toBe('READY');
    expect(scanditMock.state.subscriberCountsAtContextCreation).toEqual([1, 1]);
    expect(scanditMock.state.loadingSubscribers.size).toBe(0);

    await provider.dispose();
    expect(scanditMock.state.loadingSubscribers.size).toBe(0);
  });
});
