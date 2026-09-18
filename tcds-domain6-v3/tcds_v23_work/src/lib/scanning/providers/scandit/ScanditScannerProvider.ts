import type { DataCaptureContext } from '@scandit/web-datacapture-core';
import type { WarehouseScannerProvider } from '../../contracts/WarehouseScannerProvider';
import type { ScannerCapabilityReport } from '../../contracts/ScannerCapabilityReport';
import type { ScannerProviderMetadata } from '../../contracts/ScannerProviderMetadata';
import type { ScannerRuntimeListener, ScannerRuntimeEventType } from '../../contracts/ScannerRuntimeEvent';
import type { ScannerRuntimeStatus } from '../../contracts/ScannerRuntimeStatus';
import { ScannerProviderError } from '../../contracts/ScannerProviderError';
import { detectScannerCapabilities } from '../../runtime/scannerCapabilityDetector';
import { assertRuntimeInvariant } from '../../runtime/scannerRuntimeAssertions';
import { loadScanditRuntimeConfig, loadScanditStaticConfig } from './scanditConfig';
import { createScanditContext } from './scanditRuntime';
import { subscribeToScanditLoading } from './scanditLoadingObserver';
import { mapScanditError, errorFromContextAssessment } from './scanditErrorCatalog';
import { observeScanditContextStatus } from './scanditContextObserver';
import { enrichWithScanditCompatibility } from './scanditCapabilities';
import type { ScanditContextStatusAssessment } from './scanditContextStatusMapper';
import type {
  BarcodeCaptureCapability,
  BarcodeCaptureStartOptions,
  BarcodeCaptureStatusSource,
  BarcodeCaptureLifecycleCapability,
  BarcodeCaptureDeviceControls,
} from '../../capture/BarcodeCaptureCapability';
import type { BarcodeDecodeListener } from '../../capture/BarcodeDecodeObservation';
import type { BarcodeCaptureStatus, BarcodeCaptureStatusListener } from '../../capture/BarcodeCaptureStatus';
import { ScanditBarcodeCaptureController } from './ScanditBarcodeCaptureController';

export class ScanditScannerProvider
  implements
    WarehouseScannerProvider,
    BarcodeCaptureCapability,
    BarcodeCaptureStatusSource,
    BarcodeCaptureLifecycleCapability,
    BarcodeCaptureDeviceControls {
  readonly providerId = 'scandit';

  private context: DataCaptureContext | null = null;
  private initPromise: Promise<void> | null = null;
  private listeners = new Set<ScannerRuntimeListener>();
  private capabilities: ScannerCapabilityReport = detectScannerCapabilities();
  private unsubscribeLoading: (() => void) | null = null;
  private unsubscribeContextStatus: (() => void) | null = null;
  private readonly captureController = new ScanditBarcodeCaptureController(
    () => this.context,
  );

  private status: ScannerRuntimeStatus = {
    phase: 'UNINITIALIZED',
    ready: false,
    degraded: false,
    blocked: false,
    blockingReason: 'NONE',
    provider: 'scandit',
    degradationReasons: [],
    lastChangedAt: new Date().toISOString(),
  };

  initialize(): Promise<void> {
    if (this.status.phase === 'READY' || this.status.phase === 'DEGRADED') {
      return Promise.resolve();
    }
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initializeOnce()
      .finally(() => {
        this.initPromise = null;
      });

    return this.initPromise;
  }

  private async initializeOnce(): Promise<void> {
    const started = performance.now();

    this.setStatus({
      phase: 'CHECKING_CAPABILITIES',
      ready: false,
      blocked: false,
      degraded: false,
      blockingReason: 'NONE',
      message: undefined,
      providerStatusCode: undefined,
      providerStatusValid: undefined,
      providerStatusCategory: undefined,
      degradationReasons: [],
    });

    this.capabilities = detectScannerCapabilities();

    if (!this.capabilities.supported) {
      this.setStatus(
        {
          phase: 'BLOCKED',
          ready: false,
          blocked: true,
          degraded: false,
          blockingReason: this.blockingReason(),
          degradationReasons: [],
        },
        'BLOCKED',
        { capabilityReasons: [...this.capabilities.reasons] },
      );
      return;
    }

    try {
      this.capabilities = enrichWithScanditCompatibility(this.capabilities);
    } catch (error) {
      throw new ScannerProviderError(
        'CAPABILITY_CHECK_FAILED',
        'Scanner provider compatibility check failed.',
        false,
        'scandit',
        undefined,
        error,
      );
    }

    const providerCompatibility = this.capabilities.providerCompatibility;
    if (providerCompatibility && !providerCompatibility.fullSupport && !providerCompatibility.scannerSupport) {
      this.setStatus(
        {
          phase: 'BLOCKED',
          ready: false,
          blocked: true,
          degraded: false,
          blockingReason: 'UNSUPPORTED_BROWSER',
          degradationReasons: [],
        },
        'BLOCKED',
        { missingFeatures: providerCompatibility.missingFeatures },
      );
      return;
    }

    let config;
    try {
      config = loadScanditRuntimeConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const mapped = new ScannerProviderError(
        message.toLowerCase().includes('license')
          ? 'LICENSE_CONFIGURATION_MISSING'
          : 'INVALID_CONFIGURATION',
        'Scanner provider configuration is invalid.',
        false,
        'scandit',
        undefined,
        error,
      );

      this.setStatus(
        {
          phase: 'FAILED',
          ready: false,
          blocked: true,
          degraded: false,
          blockingReason:
            mapped.code === 'LICENSE_CONFIGURATION_MISSING'
              ? 'LICENSE_CONFIGURATION_MISSING'
              : 'UNKNOWN',
          message: mapped.message,
        },
        'ERROR',
      );
      throw mapped;
    }

    if (!config.enabled) {
      this.setStatus(
        {
          phase: 'BLOCKED',
          ready: false,
          blocked: true,
          degraded: false,
          blockingReason: 'PROVIDER_DISABLED',
        },
        'BLOCKED',
      );
      return;
    }

    this.setStatus({
      phase: 'INITIALIZING',
      ready: false,
      blocked: false,
      degraded: false,
      blockingReason: 'NONE',
    });

    try {
      // Subscribe inside the try block so the finally block always removes the loading
      // subscriber, even when a runtime listener throws while a status event is delivered.
      this.unsubscribeLoading?.();
      this.unsubscribeLoading = subscribeToScanditLoading((progress) => {
        this.setStatus(
          {
            phase: 'LOADING',
            ready: false,
            blocked: false,
            progressPercentage: progress.percentage,
            loadedBytes: progress.loadedBytes,
          },
          'LOAD_PROGRESS',
        );
      });

      this.context = await createScanditContext(config);

      this.unsubscribeContextStatus = observeScanditContextStatus(
        this.context,
        (assessment) => this.handleContextStatus(assessment),
      );

      const degradationReasons = this.computeDegradationReasons();
      const degraded = degradationReasons.length > 0;

      this.setStatus(
        {
          phase: degraded ? 'DEGRADED' : 'READY',
          ready: true,
          blocked: false,
          degraded,
          blockingReason: 'NONE',
          providerVersion: config.sdkVersion,
          runtimeAssetVersion: config.sdkVersion,
          progressPercentage: 100,
          initializedAt: new Date().toISOString(),
          initializationDurationMs: Math.round(performance.now() - started),
          degradationReasons,
        },
        degraded ? 'DEGRADED' : 'INITIALIZED',
        {
          providerCompatibility: this.capabilities.providerCompatibility,
        },
      );
    } catch (error) {
      const mapped = mapScanditError(error);

      this.setStatus(
        {
          phase: 'FAILED',
          ready: false,
          blocked: true,
          degraded: false,
          blockingReason:
            mapped.code === 'LICENSE_REJECTED'
              ? 'LICENSE_REJECTED'
              : mapped.code === 'RUNTIME_VERSION_MISMATCH'
                ? 'RUNTIME_VERSION_MISMATCH'
                : mapped.code === 'RUNTIME_ASSET_NOT_FOUND'
                  ? 'RUNTIME_ASSETS_UNAVAILABLE'
                  : 'SDK_INITIALIZATION_FAILED',
          message: mapped.message,
        },
        'ERROR',
        {
          providerErrorCode: mapped.code,
          retryable: mapped.retryable,
          providerStatusCode: mapped.providerStatusCode,
        },
      );

      throw mapped;
    } finally {
      this.unsubscribeLoading?.();
      this.unsubscribeLoading = null;
    }
  }

  async dispose(): Promise<void> {
    if (this.status.phase === 'DISPOSED') return;
    if (this.initPromise) await this.initPromise.catch(() => undefined);

    this.setStatus({
      phase: 'DISPOSING',
      ready: false,
      blocked: false,
      degraded: false,
    });

    try {
      this.unsubscribeLoading?.();
      this.unsubscribeLoading = null;

      this.unsubscribeContextStatus?.();
      this.unsubscribeContextStatus = null;

      await this.captureController.stop().catch(() => undefined);

      if (this.context) {
        await this.context.dispose();
      }

      this.context = null;

      this.setStatus(
        {
          phase: 'DISPOSED',
          ready: false,
          blocked: false,
          degraded: false,
          blockingReason: 'NONE',
          degradationReasons: [],
        },
        'DISPOSED',
      );
    } catch (error) {
      throw new ScannerProviderError(
        'DISPOSE_FAILED',
        'Scanner provider disposal failed.',
        true,
        'scandit',
        undefined,
        error,
      );
    }
  }


  async start(options: BarcodeCaptureStartOptions): Promise<void> {
    await this.initialize();

    if (!this.context || !this.getStatus().ready) {
      throw new ScannerProviderError(
        'SDK_RUNTIME_FAILURE',
        'Scanner runtime is not ready for capture.',
        true,
        'scandit',
      );
    }

    await this.captureController.start(options);
  }

  pause(): Promise<void> {
    return this.captureController.pause();
  }

  resume(): Promise<void> {
    return this.captureController.resume();
  }

  stop(): Promise<void> {
    return this.captureController.stop();
  }

  getCaptureStatus(): BarcodeCaptureStatus {
    return this.captureController.getStatus();
  }

  subscribeToScans(listener: BarcodeDecodeListener): () => void {
    return this.captureController.subscribeToScans(listener);
  }

  subscribeToCaptureStatus(
    listener: BarcodeCaptureStatusListener,
  ): () => void {
    return this.captureController.subscribeToStatus(listener);
  }

  suspendForBackground(): Promise<void> {
    return this.captureController.suspendForBackground();
  }

  resumeFromBackground(): Promise<void> {
    return this.captureController.resumeFromBackground();
  }

  setTorch(enabled: boolean): Promise<void> {
    return this.captureController.setTorch(enabled);
  }

  getStatus(): ScannerRuntimeStatus {
    return {
      ...this.status,
      degradationReasons: [...(this.status.degradationReasons ?? [])],
    };
  }

  getCapabilities(): ScannerCapabilityReport {
    return {
      ...this.capabilities,
      reasons: [...this.capabilities.reasons],
      degradedReasons: [...this.capabilities.degradedReasons],
      providerCompatibility: this.capabilities.providerCompatibility
        ? {
            ...this.capabilities.providerCompatibility,
            missingFeatures: [...this.capabilities.providerCompatibility.missingFeatures],
          }
        : undefined,
    };
  }

  getMetadata(): ScannerProviderMetadata {
    // Deliberately license-independent so diagnostics/preflight can inspect
    // provider/version/runtime location before a valid license is configured.
    const config = loadScanditStaticConfig();

    return {
      providerId: 'scandit',
      providerName: 'Scandit Data Capture SDK',
      providerVersion: config.sdkVersion,
      runtimeAssetVersion: config.sdkVersion,
      implementationVersion: '6.2B.1',
      capabilities: ['RUNTIME', 'BARCODE_CAPTURE'],
      libraryLocation: config.libraryLocation,
    };
  }

  subscribe(listener: ScannerRuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private handleContextStatus(assessment: ScanditContextStatusAssessment): void {
    if (assessment.code === 0) {
      this.setStatus(
        {
          providerStatusCode: assessment.code,
          providerStatusValid: assessment.isValid,
          providerStatusCategory: assessment.category,
        },
        'PROVIDER_STATUS',
        {
          providerStatusCode: assessment.code,
          category: assessment.category,
        },
      );
      return;
    }

    if (assessment.isValid) {
      const degradationReasons = this.computeDegradationReasons();
      const degraded = degradationReasons.length > 0;
      const wasInvalid = this.status.providerStatusValid === false;

      this.setStatus(
        {
          phase: degraded ? 'DEGRADED' : 'READY',
          ready: true,
          blocked: false,
          degraded,
          blockingReason: 'NONE',
          providerStatusCode: assessment.code,
          providerStatusValid: true,
          providerStatusCategory: assessment.category,
          message: undefined,
          degradationReasons,
        },
        wasInvalid ? 'RECOVERED' : 'PROVIDER_STATUS',
        {
          providerStatusCode: assessment.code,
          category: assessment.category,
        },
      );
      return;
    }

    const mapped = errorFromContextAssessment(assessment);

    this.setStatus(
      {
        phase: assessment.phase,
        ready: false,
        blocked: assessment.phase === 'BLOCKED' || assessment.phase === 'FAILED',
        degraded: assessment.phase === 'DEGRADED',
        blockingReason: assessment.blockingReason,
        providerStatusCode: assessment.code,
        providerStatusValid: false,
        providerStatusCategory: assessment.category,
        message: assessment.sanitizedMessage || 'Scanner provider context is invalid.',
      },
      assessment.phase === 'BLOCKED' ? 'BLOCKED' : 'ERROR',
      {
        providerStatusCode: assessment.code,
        category: assessment.category,
        providerErrorCode: mapped?.code,
        retryable: mapped?.retryable ?? assessment.retryable,
      },
    );
  }

  private computeDegradationReasons(): string[] {
    const reasons = this.capabilities.degradedReasons.filter(
      (reason) => reason !== 'SHARED_ARRAY_BUFFER_UNAVAILABLE_INFORMATIONAL',
    );

    if (
      this.capabilities.providerCompatibility &&
      !this.capabilities.providerCompatibility.fullSupport
    ) {
      reasons.push(
        ...this.capabilities.providerCompatibility.missingFeatures.map(
          (feature) => `SCANDIT_MISSING_FEATURE:${feature}`,
        ),
      );
    }

    return [...new Set(reasons)];
  }

  private blockingReason(): ScannerRuntimeStatus['blockingReason'] {
    if (!this.capabilities.secureContext) return 'SECURE_CONTEXT_REQUIRED';
    if (!this.capabilities.webAssembly) return 'WEBASSEMBLY_UNAVAILABLE';
    if (!this.capabilities.webWorkers) return 'WEB_WORKERS_UNAVAILABLE';
    if (!this.capabilities.blob) return 'BLOB_UNAVAILABLE';
    if (!this.capabilities.objectUrl) return 'OBJECT_URL_UNAVAILABLE';
    return 'UNSUPPORTED_BROWSER';
  }

  private setStatus(
    patch: Partial<ScannerRuntimeStatus>,
    forcedType?: ScannerRuntimeEventType,
    details?: Readonly<Record<string, unknown>>,
  ): void {
    this.status = {
      ...this.status,
      ...patch,
      provider: 'scandit',
      lastChangedAt: new Date().toISOString(),
    };

    assertRuntimeInvariant(this.status);

    const type =
      forcedType ??
      (this.status.phase === 'BLOCKED'
        ? 'BLOCKED'
        : this.status.phase === 'DEGRADED'
          ? 'DEGRADED'
          : this.status.phase === 'FAILED'
            ? 'ERROR'
            : 'STATUS_CHANGED');

    const event = {
      eventId: crypto.randomUUID(),
      type,
      provider: 'scandit',
      occurredAt: new Date().toISOString(),
      status: this.getStatus(),
      details,
    };

    for (const listener of this.listeners) listener(event);
  }
}
