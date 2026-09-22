import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock(
  "@scandit/web-datacapture-core",
  async () => {
    const { createCoreModule } =
      await import(
        "./support/scanditSdkFake"
      );

    return createCoreModule();
  },
);

vi.mock(
  "@scandit/web-datacapture-barcode",
  async () => {
    const { createBarcodeModule } =
      await import(
        "./support/scanditSdkFake"
      );

    return createBarcodeModule();
  },
);

import {
  ScanditBarcodeCaptureController,
} from "../../src/lib/scanning/providers/scandit/ScanditBarcodeCaptureController";
import {
  BarcodeCaptureError,
} from "../../src/lib/scanning/capture/BarcodeCaptureError";
import type {
  BarcodeCapturePhase,
} from "../../src/lib/scanning/capture/BarcodeCaptureStatus";
import type {
  BarcodeDecodeObservation,
} from "../../src/lib/scanning/capture/BarcodeDecodeObservation";
import {
  flush,
  sdk,
  waitFor,
  type FakeContext,
} from "./support/scanditSdkFake";

interface Harness {
  controller: ScanditBarcodeCaptureController;
  context: FakeContext;
  viewportElement: HTMLDivElement;
  phases: BarcodeCapturePhase[];
  observations: BarcodeDecodeObservation[];
}

function createHarness(): Harness {
  const context = sdk.createContext();

  const controller =
    new ScanditBarcodeCaptureController(
      () => context as never,
    );

  const phases: BarcodeCapturePhase[] = [];
  const observations: BarcodeDecodeObservation[] = [];

  controller.subscribeToStatus(
    (status) => {
      if (
        phases[phases.length - 1] !==
        status.phase
      ) {
        phases.push(status.phase);
      }
    },
  );

  controller.subscribeToScans(
    (observation) => {
      observations.push(observation);
    },
  );

  return {
    controller,
    context,
    viewportElement:
      document.createElement("div"),
    phases,
    observations,
  };
}

function cameraFailure(
  name: string,
  message: string,
): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

beforeEach(() => {
  sdk.reset();

  if (
    typeof globalThis.crypto
      ?.randomUUID !== "function"
  ) {
    Object.defineProperty(
      globalThis,
      "crypto",
      {
        configurable: true,
        value: {
          ...globalThis.crypto,
          randomUUID: () =>
            `observation-${Math.random()
              .toString(16)
              .slice(2)}`,
        },
      },
    );
  }
});

describe("6.2B capture lifecycle", () => {
  it("does not decode a barcode that is already visible while the camera starts", async () => {
    const harness = createHarness();

    // The barcode is in view at the moment the camera reaches the ON state.
    sdk.onCameraStarted = () => {
      sdk.emitScan("VISIBLE-AT-START");
    };

    await harness.controller.start({
      viewportElement:
        harness.viewportElement,
      preferredCamera: "WORLD_FACING",
    });

    await flush();

    // The mode is created disabled, so capture is not live from camera start.
    expect(
      sdk.capture.enabledHistory[0],
    ).toBe(false);

    expect(harness.phases).not.toContain(
      "DECODED",
    );
    expect(
      harness.observations,
    ).toHaveLength(0);
    expect(
      harness.controller.getStatus()
        .phase,
    ).toBe("CAPTURING");
  });

  it("clears the SDK feedback and emits nothing when the policy disables feedback", async () => {
    const harness = createHarness();
    const vibrate = vi.fn();

    Object.defineProperty(
      navigator,
      "vibrate",
      {
        configurable: true,
        value: vibrate,
      },
    );

    await harness.controller.start({
      viewportElement:
        harness.viewportElement,
    });

    const applied =
      sdk.capture.feedbackHistory[
        sdk.capture.feedbackHistory
          .length - 1
      ];

    expect(applied).toBeDefined();
    expect(applied?.sound).toBeNull();
    expect(
      applied?.vibration,
    ).toBeNull();

    sdk.emitScan("POLICY-FEEDBACK");
    await flush();

    expect(vibrate).not.toHaveBeenCalled();
    expect(
      harness.observations,
    ).toHaveLength(1);
    expect(
      harness.controller.getStatus()
        .phase,
    ).toBe("PAUSED");
  });

  it("releases the timed-out attempt before the next Start", async () => {
    const harness = createHarness();

    await harness.controller.start({
      viewportElement:
        harness.viewportElement,
      captureTimeoutMs: 20,
    });

    const firstCamera = sdk.camera;
    const firstCapture = sdk.capture;
    const firstView = sdk.views[0];

    await waitFor(
      () =>
        harness.controller.getStatus()
          .lastErrorCode ===
        "CAPTURE_TIMEOUT",
    );

    expect(
      harness.controller.getStatus()
        .phase,
    ).toBe("CAPTURE_ERROR");

    await harness.controller.start({
      viewportElement:
        harness.viewportElement,
    });

    expect(firstCamera.state).toBe(
      "off",
    );
    expect(
      firstCamera.stopCalls,
    ).toBeGreaterThan(0);
    expect(
      firstCapture.removedListeners,
    ).toBe(1);
    expect(
      harness.context.removedModes,
    ).toContain(firstCapture);
    expect(firstView?.detachCount).toBe(
      1,
    );
    expect(sdk.captures).toHaveLength(2);
    expect(
      harness.controller.getStatus()
        .phase,
    ).toBe("CAPTURING");
  });

  it("recovers on the next Start after a camera failure", async () => {
    const harness = createHarness();

    sdk.cameraStartFailures.push(
      cameraFailure(
        "NotAllowedError",
        "Permission dismissed by the operator.",
      ),
    );

    await expect(
      harness.controller.start({
        viewportElement:
          harness.viewportElement,
      }),
    ).rejects.toBeInstanceOf(
      BarcodeCaptureError,
    );

    expect(
      harness.controller.getStatus()
        .phase,
    ).toBe("PERMISSION_DENIED");

    await harness.controller.start({
      viewportElement:
        harness.viewportElement,
    });

    expect(
      sdk.captures[0]?.removedListeners,
    ).toBe(1);
    expect(sdk.cameras[0]?.state).toBe(
      "off",
    );
    expect(
      sdk.views[0]?.detachCount,
    ).toBe(1);
    expect(
      harness.controller.getStatus()
        .phase,
    ).toBe("CAPTURING");
  });

  it("does not turn a failed scanner into READY through background and resume", async () => {
    const harness = createHarness();

    sdk.cameraStartFailures.push(
      cameraFailure(
        "NotAllowedError",
        "Permission dismissed by the operator.",
      ),
    );

    await expect(
      harness.controller.start({
        viewportElement:
          harness.viewportElement,
      }),
    ).rejects.toBeInstanceOf(
      BarcodeCaptureError,
    );

    const failureIndex =
      harness.phases.lastIndexOf(
        "PERMISSION_DENIED",
      );

    await harness.controller.suspendForBackground();
    await harness.controller.resumeFromBackground();

    const status =
      harness.controller.getStatus();

    expect(status.phase).toBe(
      "PERMISSION_DENIED",
    );
    expect(
      status.backgroundSuspended,
    ).toBe(false);
    expect(
      harness.phases.slice(
        failureIndex,
      ),
    ).not.toContain("READY");
  });

  it("keeps raw SDK exceptions out of the capture error and the cleanup record", async () => {
    const harness = createHarness();

    const raw = cameraFailure(
      "NotReadableError",
      "Camera pipeline failed for https://scandit.example/session?licenseKey=S3CR3TVALUE1234",
    );

    sdk.cameraStartFailures.push(raw);

    const startError = await harness.controller
      .start({
        viewportElement:
          harness.viewportElement,
      })
      .catch(
        (error: unknown) => error,
      );

    expect(
      startError,
    ).toBeInstanceOf(
      BarcodeCaptureError,
    );

    const captureError =
      startError as BarcodeCaptureError;

    expect(captureError.code).toBe(
      "CAMERA_NOT_READABLE",
    );
    expect(
      captureError.cause,
    ).not.toBe(raw);
    expect(
      captureError.cause,
    ).not.toBeInstanceOf(Error);
    expect(
      captureError.cause?.message,
    ).not.toContain("S3CR3TVALUE1234");
    expect(
      captureError.cause?.message,
    ).not.toContain("https://");
    expect(
      JSON.stringify(captureError.cause),
    ).not.toContain("scandit.example");

    // The same rule applies to cleanup records leaving the provider.
    await harness.controller.start({
      viewportElement:
        harness.viewportElement,
    });

    sdk.cameraStopFailures.push(
      cameraFailure(
        "InvalidStateError",
        "Release failed for https://scandit.example/session?licenseKey=S3CR3TVALUE1234",
      ),
    );

    const stopError = await harness.controller
      .stop()
      .catch(
        (error: unknown) => error,
      );

    const cleanupError =
      stopError as BarcodeCaptureError;

    expect(
      cleanupError.code,
    ).toBe("CAPTURE_CLEANUP_FAILED");

    const cleanupText = JSON.stringify(
      cleanupError.cleanupFailures,
    );

    expect(cleanupText).toContain(
      "STOP_CAMERA",
    );
    expect(cleanupText).not.toContain(
      "S3CR3TVALUE1234",
    );
    expect(cleanupText).not.toContain(
      "scandit.example",
    );
  });

  it("leaves no stale camera session when Start runs twice", async () => {
    const harness = createHarness();

    await harness.controller.start({
      viewportElement:
        harness.viewportElement,
    });

    await harness.controller.start({
      viewportElement:
        harness.viewportElement,
    });

    expect(sdk.cameras).toHaveLength(2);
    expect(sdk.cameras[0]?.state).toBe(
      "off",
    );
    expect(sdk.cameras[1]?.state).toBe(
      "on",
    );
    expect(sdk.attachedViews).toBe(2);
    expect(sdk.detachedViews).toBe(1);
    expect(
      sdk.captures[0]?.removedListeners,
    ).toBe(1);
    expect(
      harness.controller.getStatus()
        .phase,
    ).toBe("CAPTURING");
  });

  it("leaks no listeners or views across repeated failures and a final recovery", async () => {
    const harness = createHarness();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      sdk.cameraStartFailures.push(
        cameraFailure(
          "NotReadableError",
          "Camera busy.",
        ),
      );

      await expect(
        harness.controller.start({
          viewportElement:
            harness.viewportElement,
        }),
      ).rejects.toBeInstanceOf(
        BarcodeCaptureError,
      );
    }

    await harness.controller.start({
      viewportElement:
        harness.viewportElement,
    });

    const live = sdk.captures.length - 1;

    sdk.captures.forEach(
      (capture, index) => {
        expect(
          capture.addedListeners,
        ).toBe(1);
        expect(
          capture.removedListeners,
        ).toBe(index === live ? 0 : 1);
      },
    );

    sdk.cameras.forEach(
      (camera, index) => {
        expect(
          camera.addedListeners,
        ).toBe(1);
        expect(
          camera.removedListeners,
        ).toBe(index === live ? 0 : 1);
        expect(camera.state).toBe(
          index === live ? "on" : "off",
        );
      },
    );

    expect(sdk.detachedViews).toBe(
      sdk.views.length - 1,
    );
    expect(
      harness.controller.getStatus()
        .phase,
    ).toBe("CAPTURING");
  });

  it("rejects a decode that arrives from a previous session", async () => {
    const harness = createHarness();

    await harness.controller.start({
      viewportElement:
        harness.viewportElement,
    });

    const stale = sdk.capture;

    // The SDK had already dispatched this callback when the session was replaced.
    const staleListener = [
      ...stale.listeners,
    ][0];

    await harness.controller.start({
      viewportElement:
        harness.viewportElement,
    });

    expect(sdk.capture).not.toBe(stale);
    expect(staleListener).toBeDefined();

    const disableCallsBefore =
      stale.enabledHistory.length;

    staleListener?.didScan?.(stale, {
      newlyRecognizedBarcode: {
        data: "STALE-SESSION",
        rawData: "STALE-SESSION",
        symbology: "qr",
      },
      frameSequenceID: 99,
    });

    await flush();

    // It is ignored, and the stale mode is disabled instead of driving state.
    expect(
      harness.observations,
    ).toHaveLength(0);
    expect(harness.phases).not.toContain(
      "DECODED",
    );
    expect(
      stale.enabledHistory.length,
    ).toBe(disableCallsBefore + 1);
    expect(
      stale.enabledHistory[
        stale.enabledHistory.length - 1
      ],
    ).toBe(false);
    expect(
      harness.controller.getStatus()
        .phase,
    ).toBe("CAPTURING");
  });
});
