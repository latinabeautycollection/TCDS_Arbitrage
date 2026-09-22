import type {
  BarcodeCapture,
  BarcodeCaptureListener,
} from "@scandit/web-datacapture-barcode";
import {
  CameraPosition,
  FrameSourceState,
} from "@scandit/web-datacapture-core";
import type {
  Camera,
  DataCaptureContext,
  DataCaptureView,
} from "@scandit/web-datacapture-core";

import {
  DOMAIN6_2B_CERTIFICATION_POLICY,
  type BarcodeCaptureExecutionPolicy,
  type BarcodeCaptureStartOptions,
} from "../../capture/BarcodeCaptureCapability";
import type {
  BarcodeDecodeListener,
  BarcodeDecodeObservation,
} from "../../capture/BarcodeDecodeObservation";
import type {
  BarcodeCaptureStatus,
  BarcodeCaptureStatusListener,
  BarcodeCapturePhase,
} from "../../capture/BarcodeCaptureStatus";
import {
  BarcodeCaptureError,
  type CaptureCleanupFailure,
} from "../../capture/BarcodeCaptureError";
import {
  assertCaptureTransition,
} from "../../capture/captureStateMachine";
import {
  sanitizeProviderErrorCause,
} from "../../contracts/ScannerProviderError";

import {
  createScanditBarcodeCapture,
} from "./scanditBarcodeCapture";
import {
  createScanditCaptureListener,
} from "./scanditCaptureListener";
import {
  createAndAttachScanditView,
  detachScanditView,
} from "./scanditDataCaptureView";
import {
  getCameraControls,
  observeCameraState,
  prepareCamera,
  selectScanditCamera,
  setCameraTorch,
  startCamera,
  stopCamera,
  verifyPreferredCameraAfterAccess,
} from "./scanditCamera";
import {
  mapScanditCaptureError,
} from "./scanditCaptureErrors";
import {
  executeCaptureFeedback,
} from "./captureFeedbackExecutor";

type ContextProvider = () => DataCaptureContext | null;

// Cleanup records are diagnostics that leave the provider. The raw SDK message
// is redacted first so no provider internals or credentials travel with them.
function cleanupFailureMessage(
  error: unknown,
  fallback: string,
): string {
  const sanitized =
    sanitizeProviderErrorCause(error)
      ?.message;

  return sanitized && sanitized.length
    ? sanitized
    : fallback;
}

export class ScanditBarcodeCaptureController {
  private capture: BarcodeCapture | null = null;
  private camera: Camera | null = null;
  private view: DataCaptureView | null = null;
  private listener: BarcodeCaptureListener | null = null;
  private unsubscribeCameraState: (() => void) | null = null;
  private startOptions: BarcodeCaptureStartOptions | null = null;
  private executionPolicy: BarcodeCaptureExecutionPolicy =
    DOMAIN6_2B_CERTIFICATION_POLICY;

  private readonly scanListeners =
    new Set<BarcodeDecodeListener>();
  private readonly statusListeners =
    new Set<BarcodeCaptureStatusListener>();

  private operationQueue: Promise<void> =
    Promise.resolve();
  private scanHandling = false;
  private timeoutHandle: ReturnType<
    typeof setTimeout
  > | null = null;
  private captureStartedAtMs = 0;
  private wasActiveBeforeBackground = false;

  private status: BarcodeCaptureStatus = {
    phase: "IDLE",
    provider: "scandit",
    permission: "NOT_REQUESTED",
    cameraOn: false,
    captureEnabled: false,
    viewAttached: false,
    torchAvailable: false,
    torchOn: false,
    zoomAvailable: false,
    backgroundSuspended: false,
    lastChangedAt: new Date().toISOString(),
  };

  constructor(
    private readonly contextProvider: ContextProvider,
  ) {}

  start(
    options: BarcodeCaptureStartOptions,
  ): Promise<void> {
    return this.enqueue(() =>
      this.startInternal(options),
    );
  }

  pause(): Promise<void> {
    return this.enqueue(() =>
      this.pauseInternal(),
    );
  }

  resume(): Promise<void> {
    return this.enqueue(() =>
      this.resumeInternal(),
    );
  }

  stop(): Promise<void> {
    return this.enqueue(() =>
      this.stopInternal(),
    );
  }

  suspendForBackground(): Promise<void> {
    return this.enqueue(async () => {
      if (
        this.status.phase === "STOPPED" ||
        this.status.phase === "IDLE" ||
        this.isUnrecoverablePhase()
      ) {
        // A failed or blocked scanner has nothing to suspend, and must not be
        // recorded as merely background-suspended.
        return;
      }

      this.wasActiveBeforeBackground =
        this.status.captureEnabled ||
        this.status.phase === "CAPTURING";

      this.clearCaptureTimeout();

      try {
        if (this.capture?.isEnabled()) {
          await this.capture.setEnabled(false);
        }

        if (this.camera) {
          await stopCamera(this.camera);
        }
      } catch (error) {
        const mapped = new BarcodeCaptureError(
          "CAPTURE_PAUSE_FAILED",
          "Scanner could not suspend cleanly while the PWA was backgrounded.",
          true,
          error,
        );
        this.handleCaptureFailure(mapped);
        throw mapped;
      }

      this.patchStatus({
        phase: "PAUSED",
        captureEnabled: false,
        cameraOn: false,
        backgroundSuspended: true,
        message:
          "Capture suspended while the PWA is not visible.",
      });
    });
  }

  resumeFromBackground(): Promise<void> {
    return this.enqueue(async () => {
      if (
        !this.status.backgroundSuspended ||
        !this.startOptions ||
        this.isUnrecoverablePhase()
      ) {
        // Returning to the foreground is not a recovery. A failed or blocked
        // scanner becomes READY again only through a successful restart.
        return;
      }

      this.transition("RECOVERING", {
        message: "Restoring camera after background suspension.",
      });

      try {
        if (this.camera) {
          this.transition("CAMERA_STARTING");
          await startCamera(this.camera);
        }

        this.patchStatus({
          permission: "GRANTED",
          backgroundSuspended: false,
        });

        if (
          this.wasActiveBeforeBackground &&
          this.capture
        ) {
          await this.capture.setEnabled(true);
          this.captureStartedAtMs =
            performance.now();
          this.transition("CAPTURING", {
            captureEnabled: true,
            message: undefined,
          });
          this.armCaptureTimeout();
        } else {
          this.transition("READY", {
            captureEnabled: false,
            message: undefined,
          });
        }

        this.wasActiveBeforeBackground = false;
      } catch (error) {
        const mapped =
          mapScanditCaptureError(error);
        this.handleCaptureFailure(mapped);
        throw mapped;
      }
    });
  }

  getStatus(): BarcodeCaptureStatus {
    return { ...this.status };
  }

  subscribeToScans(
    listener: BarcodeDecodeListener,
  ): () => void {
    this.scanListeners.add(listener);
    return () => this.scanListeners.delete(listener);
  }

  subscribeToStatus(
    listener: BarcodeCaptureStatusListener,
  ): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => this.statusListeners.delete(listener);
  }

  setTorch(enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (!this.camera || !this.status.torchAvailable) {
        throw new BarcodeCaptureError(
          "TORCH_UNAVAILABLE",
          "Torch control is unavailable on this browser/device.",
          false,
        );
      }

      try {
        await setCameraTorch(
          this.camera,
          enabled,
        );

        this.patchStatus({
          torchOn: enabled,
        });
      } catch (error) {
        throw new BarcodeCaptureError(
          "TORCH_CONTROL_FAILED",
          "Torch state could not be changed.",
          true,
          error,
        );
      }
    });
  }

  private async startInternal(
    options: BarcodeCaptureStartOptions,
  ): Promise<void> {
    if (!(options.viewportElement instanceof HTMLElement)) {
      throw new BarcodeCaptureError(
        "VIEWPORT_REQUIRED",
        "A scanner viewport element is required.",
        false,
      );
    }

    // Every phase except IDLE/STOPPED can still own a camera, a capture mode, a
    // listener or an attached view. Error phases included: a retry after a
    // timeout or a failure must never build a second session on top of the old
    // one.
    if (
      this.status.phase !== "IDLE" &&
      this.status.phase !== "STOPPED"
    ) {
      await this.stopInternal();
    }

    const context =
      this.contextProvider();

    if (!context) {
      this.transition("BLOCKED", {
        message:
          "Scanner runtime must be initialized before camera capture starts.",
      });

      throw new BarcodeCaptureError(
        "RUNTIME_NOT_READY",
        "Scanner runtime is not ready.",
        true,
      );
    }

    this.startOptions = options;
    this.executionPolicy =
      options.executionPolicy ??
      DOMAIN6_2B_CERTIFICATION_POLICY;
    this.transition("CAMERA_REQUESTED", {
      permission: "REQUESTING",
      message: undefined,
      lastErrorCode: undefined,
    });

    let camera =
      selectScanditCamera(
        options.preferredCamera ??
          "WORLD_FACING",
      );

    try {
      await prepareCamera(camera);

      this.capture =
        await createScanditBarcodeCapture(
          context,
          this.executionPolicy,
        );

      this.listener =
        createScanditCaptureListener(
          (result, capture) => {
            void this.onDecoded(
              result.observation,
              capture,
            );
          },
        );

      this.capture.addListener(
        this.listener,
      );

      this.view =
        await createAndAttachScanditView(
          context,
          options.viewportElement,
          this.executionPolicy.scanArea,
        );

      this.patchStatus({
        viewAttached: true,
      });

      await this.bindCamera(context, camera);

      this.transition(
        "PERMISSION_PENDING",
        {
          permission: "REQUESTING",
        },
      );

      this.transition(
        "CAMERA_STARTING",
      );

      try {
        await startCamera(camera);
      } catch (firstError) {
        const mapped =
          mapScanditCaptureError(
            firstError,
          );

        if (
          mapped.code !==
          "CAMERA_UNAVAILABLE" ||
          (options.preferredCamera ??
            "WORLD_FACING") ===
            "BEST_AVAILABLE"
        ) {
          throw firstError;
        }

        camera =
          selectScanditCamera(
            "BEST_AVAILABLE",
          );

        await prepareCamera(camera);
        await this.bindCamera(
          context,
          camera,
        );
        await startCamera(camera);
      }

      // Web camera metadata can become accurate only after access. Re-check
      // the actual position and, on iOS/WebKit, select a discovered world-
      // facing camera when the initial heuristic selected incorrectly.
      const verified =
        await verifyPreferredCameraAfterAccess(
          camera,
          options.preferredCamera ??
            "WORLD_FACING",
        );

      if (
        verified.camera !== camera &&
        verified.verifiedWorldFacing
      ) {
        await stopCamera(camera);
        camera = verified.camera;
        await prepareCamera(camera);
        await this.bindCamera(
          context,
          camera,
        );
        await startCamera(camera);
      }

      const controls =
        await getCameraControls(
          camera,
        );

      this.patchStatus({
        permission: "GRANTED",
        cameraOn:
          camera.getCurrentState() ===
          FrameSourceState.On,
        torchAvailable:
          controls.torchAvailable,
        zoomAvailable:
          controls.zoomAvailable,
        message:
          (options.preferredCamera ?? "WORLD_FACING") === "WORLD_FACING" &&
          camera.position !== CameraPosition.WorldFacing
            ? "World-facing camera could not be positively verified; best available camera is active."
            : undefined,
      });

      this.transition("READY");

      await this.capture.setEnabled(true);

      this.captureStartedAtMs =
        performance.now();

      this.transition("CAPTURING", {
        captureEnabled: true,
        startedAt:
          new Date().toISOString(),
      });

      this.armCaptureTimeout();
    } catch (error) {
      const mapped =
        mapScanditCaptureError(error);

      let cleanupFailure:
        | BarcodeCaptureError
        | undefined;

      try {
        await this.cleanupResources();
      } catch (cleanupError) {
        cleanupFailure =
          cleanupError instanceof BarcodeCaptureError
            ? cleanupError
            : new BarcodeCaptureError(
                "CAPTURE_CLEANUP_FAILED",
                "Capture startup failed and resources were not released cleanly.",
                true,
                cleanupError,
              );
      }

      const finalError =
        cleanupFailure
          ? new BarcodeCaptureError(
              mapped.code,
              mapped.message,
              mapped.retryable,
              {
                primary: mapped,
                cleanup: cleanupFailure,
              },
              cleanupFailure.cleanupFailures,
            )
          : mapped;

      this.handleCaptureFailure(
        finalError,
      );

      throw finalError;
    }
  }

  private async bindCamera(
    context: DataCaptureContext,
    camera: Camera,
  ): Promise<void> {
    this.unsubscribeCameraState?.();
    this.unsubscribeCameraState = null;

    this.camera = camera;

    this.unsubscribeCameraState =
      observeCameraState(
        camera,
        (observedState) => {
          this.patchStatus({
            cameraOn:
              observedState === "ON",
          });
        },
      );

    await context.setFrameSource(
      camera,
    );
  }

  private async pauseInternal(): Promise<void> {
    if (
      this.status.phase === "PAUSED" ||
      this.status.phase === "DECODED"
    ) {
      return;
    }

    if (!this.capture) {
      return;
    }

    try {
      this.clearCaptureTimeout();

      await this.capture.setEnabled(false);

      this.transition("PAUSED", {
        captureEnabled: false,
      });
    } catch (error) {
      const mapped =
        new BarcodeCaptureError(
          "CAPTURE_PAUSE_FAILED",
          "Barcode capture could not be paused.",
          true,
          error,
        );

      this.handleCaptureFailure(mapped);
      throw mapped;
    }
  }

  private async resumeInternal(): Promise<void> {
    if (
      this.status.phase === "CAPTURING"
    ) {
      return;
    }

    if (
      !this.capture ||
      !this.camera
    ) {
      if (!this.startOptions) {
        throw new BarcodeCaptureError(
          "CAPTURE_RESUME_FAILED",
          "No scanner session is available to resume.",
          false,
        );
      }

      return this.startInternal(
        this.startOptions,
      );
    }

    try {
      if (!this.status.cameraOn) {
        this.transition(
          "CAMERA_STARTING",
        );
        await startCamera(this.camera);
        this.patchStatus({
          permission: "GRANTED",
        });
      }

      await this.capture.setEnabled(true);

      this.captureStartedAtMs =
        performance.now();

      this.transition("CAPTURING", {
        captureEnabled: true,
        message: undefined,
      });

      this.armCaptureTimeout();
    } catch (error) {
      const mapped =
        new BarcodeCaptureError(
          "CAPTURE_RESUME_FAILED",
          "Barcode capture could not be resumed.",
          true,
          error,
        );

      this.handleCaptureFailure(mapped);
      throw mapped;
    }
  }

  private async stopInternal(): Promise<void> {
    this.clearCaptureTimeout();
    this.scanHandling = false;

    if (
      this.status.phase === "IDLE" ||
      this.status.phase === "STOPPED"
    ) {
      return;
    }

    try {
      await this.cleanupResources();

      this.transition("STOPPED", {
        permission:
          this.status.permission ===
          "DENIED"
            ? "DENIED"
            : this.status.permission,
        cameraOn: false,
        captureEnabled: false,
        viewAttached: false,
        torchAvailable: false,
        torchOn: false,
        zoomAvailable: false,
        backgroundSuspended: false,
        message: undefined,
      });
    } catch (error) {
      const mapped =
        error instanceof BarcodeCaptureError
          ? error
          : new BarcodeCaptureError(
              "CAPTURE_STOP_FAILED",
              "Scanner capture resources could not be released cleanly.",
              true,
              error,
            );

      this.handleCaptureFailure(mapped);
      throw mapped;
    }
  }

  private async cleanupResources(): Promise<void> {
    const context =
      this.contextProvider();

    const failures: CaptureCleanupFailure[] = [];

    const capture = this.capture;
    const camera = this.camera;
    const listener = this.listener;
    const view = this.view;
    const unsubscribeCameraState =
      this.unsubscribeCameraState;

    // Documented order: disable capture first, then stop frame source.
    if (capture) {
      try {
        await capture.setEnabled(false);
      } catch (error) {
        failures.push({
          step: "DISABLE_CAPTURE",
          message:
            cleanupFailureMessage(
              error,
              "Capture disable failed.",
            ),
        });
      }
    }

    if (camera) {
      try {
        await stopCamera(camera);
      } catch (error) {
        failures.push({
          step: "STOP_CAMERA",
          message:
            cleanupFailureMessage(
              error,
              "Camera stop failed.",
            ),
        });
      }
    }

    if (
      capture &&
      listener
    ) {
      try {
        capture.removeListener(
          listener,
        );
      } catch (error) {
        failures.push({
          step:
            "REMOVE_CAPTURE_LISTENER",
          message:
            cleanupFailureMessage(
              error,
              "Capture listener removal failed.",
            ),
        });
      }
    }

    if (view) {
      try {
        detachScanditView(view);
      } catch (error) {
        failures.push({
          step: "DETACH_VIEW",
          message:
            cleanupFailureMessage(
              error,
              "View detach failed.",
            ),
        });
      }
    }

    if (context) {
      try {
        await context.setFrameSource(null);
      } catch (error) {
        failures.push({
          step: "CLEAR_FRAME_SOURCE",
          message:
            cleanupFailureMessage(
              error,
              "Frame source clear failed.",
            ),
        });
      }

      if (capture) {
        try {
          await context.removeMode(
            capture,
          );
        } catch (error) {
          failures.push({
            step: "REMOVE_MODE",
            message:
              cleanupFailureMessage(
                error,
                "Capture mode removal failed.",
              ),
          });
        }
      }
    }

    try {
      unsubscribeCameraState?.();
    } catch (error) {
      failures.push({
        step: "REMOVE_CAMERA_LISTENER",
        message:
          cleanupFailureMessage(
            error,
            "Camera state listener removal failed.",
          ),
      });
    }

    // Clear local references after all best-effort release attempts. Failure is
    // still surfaced and STOPPED is not reported unless every critical release
    // step succeeded.
    this.unsubscribeCameraState = null;
    this.listener = null;
    this.capture = null;
    this.camera = null;
    this.view = null;

    this.patchStatus({
      cameraOn: false,
      captureEnabled: false,
      viewAttached: false,
      torchAvailable: false,
      torchOn: false,
      zoomAvailable: false,
    });

    if (failures.length) {
      throw new BarcodeCaptureError(
        "CAPTURE_CLEANUP_FAILED",
        `Scanner cleanup failed in ${failures.length} step(s).`,
        true,
        failures,
        failures,
      );
    }
  }

  private async onDecoded(
    observation: BarcodeDecodeObservation,
    capture: BarcodeCapture,
  ): Promise<void> {
    // A decode can still arrive from a previous session, or before this session
    // reaches CAPTURING. Neither may drive the state machine.
    if (capture !== this.capture) {
      try {
        await capture.setEnabled(false);
      } catch {
        // A stale mode that cannot be disabled is already being released.
      }

      return;
    }

    if (
      this.status.phase !== "CAPTURING"
    ) {
      return;
    }

    if (this.scanHandling) return;
    this.scanHandling = true;

    try {
      this.clearCaptureTimeout();

      // 6.2B transaction-safety contract:
      // decode -> disable capture -> emit provider-neutral observation.
      await capture.setEnabled(false);

      const duration =
        this.captureStartedAtMs > 0
          ? Math.max(
              0,
              Math.round(
                performance.now() -
                  this.captureStartedAtMs,
              ),
            )
          : undefined;

      const enriched: BarcodeDecodeObservation = {
        ...observation,
        captureDurationMs: duration,
        deviceMetadata: {
          ...observation.deviceMetadata,
          cameraDeviceId:
            this.camera?.deviceId ||
            undefined,
        },
        capturePolicyLineage:
          this.executionPolicy.lineage,
      };

      this.transition("DECODED", {
        captureEnabled: false,
        lastDecodedAt:
          enriched.capturedAt,
      });

      this.transition("PAUSED", {
        captureEnabled: false,
        message:
          "Barcode decoded. Capture is paused pending explicit resume.",
      });

      await executeCaptureFeedback(
        this.executionPolicy.feedback,
      );

      // Consumer failures must never poison provider/camera health.
      for (
        const listener of this.scanListeners
      ) {
        try {
          listener(enriched);
        } catch (listenerError) {
          console.error(
            "Barcode scan subscriber failed; scanner state was preserved.",
            listenerError,
          );
        }
      }
    } catch (error) {
      const mapped =
        mapScanditCaptureError(error);

      this.handleCaptureFailure(mapped);
    } finally {
      this.scanHandling = false;
    }
  }

  private armCaptureTimeout(): void {
    this.clearCaptureTimeout();

    const timeout =
      this.startOptions
        ?.captureTimeoutMs;

    if (!timeout || timeout <= 0) {
      return;
    }

    this.timeoutHandle = setTimeout(
      () => {
        void this.enqueue(async () => {
          if (
            this.status.phase !==
            "CAPTURING"
          ) {
            return;
          }

          // A timed-out attempt is finished. The camera, listener, view and
          // capture mode are released now instead of staying live until the
          // next Start, so no stream, indicator or half-live mode survives it.
          let cleanupFailure:
            | BarcodeCaptureError
            | undefined;

          try {
            await this.cleanupResources();
          } catch (error) {
            cleanupFailure =
              error instanceof BarcodeCaptureError
                ? error
                : new BarcodeCaptureError(
                    "CAPTURE_CLEANUP_FAILED",
                    "Capture timed out and resources were not released cleanly.",
                    true,
                    error,
                  );
          }

          this.handleCaptureFailure(
            new BarcodeCaptureError(
              "CAPTURE_TIMEOUT",
              "No barcode was decoded before the configured capture timeout.",
              true,
              cleanupFailure,
              cleanupFailure?.cleanupFailures,
            ),
          );
        });
      },
      timeout,
    );
  }

  private clearCaptureTimeout(): void {
    if (!this.timeoutHandle) return;
    clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
  }

  private handleCaptureFailure(
    error: BarcodeCaptureError,
  ): void {
    const phase: BarcodeCapturePhase =
      error.code ===
      "CAMERA_PERMISSION_DENIED"
        ? "PERMISSION_DENIED"
        : error.code ===
            "CAMERA_UNAVAILABLE"
          ? "CAMERA_UNAVAILABLE"
          : error.code.startsWith(
                "CAMERA_",
              )
            ? "CAMERA_ERROR"
            : "CAPTURE_ERROR";

    const permission =
      error.code ===
      "CAMERA_PERMISSION_DENIED"
        ? "DENIED"
        : error.code ===
            "CAMERA_UNAVAILABLE"
          ? "UNAVAILABLE"
          : this.status.permission ===
              "REQUESTING"
            ? "ERROR"
            : this.status.permission;

    this.transition(phase, {
      permission,
      captureEnabled: false,
      lastErrorCode: error.code,
      message: error.message,
    });
  }

  private isUnrecoverablePhase(): boolean {
    return (
      this.status.phase ===
        "PERMISSION_DENIED" ||
      this.status.phase ===
        "CAMERA_UNAVAILABLE" ||
      this.status.phase ===
        "CAMERA_ERROR" ||
      this.status.phase ===
        "CAPTURE_ERROR" ||
      this.status.phase === "BLOCKED"
    );
  }

  private transition(
    phase: BarcodeCapturePhase,
    patch: Partial<BarcodeCaptureStatus> = {},
  ): void {
    assertCaptureTransition(
      this.status.phase,
      phase,
    );

    this.status = {
      ...this.status,
      ...patch,
      phase,
      provider: "scandit",
      lastChangedAt:
        new Date().toISOString(),
    };

    this.emitStatus();
  }

  private patchStatus(
    patch: Partial<BarcodeCaptureStatus>,
  ): void {
    this.status = {
      ...this.status,
      ...patch,
      provider: "scandit",
      lastChangedAt:
        new Date().toISOString(),
    };

    this.emitStatus();
  }

  private emitStatus(): void {
    const snapshot =
      this.getStatus();

    for (
      const listener of this.statusListeners
    ) {
      try {
        listener(snapshot);
      } catch (listenerError) {
        console.error(
          "Barcode status subscriber failed; scanner state was preserved.",
          listenerError,
        );
      }
    }
  }

  private enqueue<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const next =
      this.operationQueue.then(
        operation,
        operation,
      );

    this.operationQueue =
      next.then(
        () => undefined,
        () => undefined,
      );

    return next;
  }
}
