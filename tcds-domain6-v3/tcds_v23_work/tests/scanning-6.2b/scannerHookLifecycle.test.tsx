import {
  act,
  render,
} from "@testing-library/react";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const runtimeMock = vi.hoisted(() => {
  interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
  }

  function defer(): Deferred {
    let resolve: () => void = () => undefined;

    const promise = new Promise<void>(
      (done) => {
        resolve = done;
      },
    );

    return { promise, resolve };
  }

  const state = {
    startCalls: 0,
    stopCalls: 0,
    pendingStart: defer(),
    captureStatus: {
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
      lastChangedAt:
        new Date().toISOString(),
    },
    runtimeStatus: {
      phase: "READY",
      ready: true,
      degraded: false,
      blocked: false,
      blockingReason: "NONE",
      provider: "scandit",
      lastChangedAt:
        new Date().toISOString(),
    },
    reset(): void {
      state.startCalls = 0;
      state.stopCalls = 0;
      state.pendingStart = defer();
    },
  };

  const runtime = {
    providerId: "scandit",
    async initialize() {},
    async dispose() {},
    getStatus: () => state.runtimeStatus,
    getCapabilities: () => ({}),
    getMetadata: () => ({
      providerId: "scandit",
      providerName: "Scandit Data Capture SDK",
      providerVersion: "8.5.3",
      runtimeAssetVersion: "8.5.3",
      implementationVersion: "6.2B.1",
      capabilities: ["RUNTIME", "BARCODE_CAPTURE"],
    }),
    subscribe: () => () => undefined,
    getCaptureStatus: () =>
      state.captureStatus,
    subscribeToCaptureStatus: () =>
      () => undefined,
    subscribeToScans: () =>
      () => undefined,
    async start() {
      state.startCalls += 1;
      await state.pendingStart.promise;
    },
    async stop() {
      state.stopCalls += 1;
    },
    async pause() {},
    async resume() {},
    async suspendForBackground() {},
    async resumeFromBackground() {},
    async setTorch() {},
  };

  return { state, runtime };
});

vi.mock(
  "../../src/lib/scanning/runtime/scannerRuntimeRegistry",
  () => ({
    getScannerRuntime: () =>
      runtimeMock.runtime,
    disposeScannerRuntime: async () => undefined,
  }),
);

import {
  useBarcodeScanner,
  type UseBarcodeScannerResult,
} from "../../src/hooks/useBarcodeScanner";

let scanner: UseBarcodeScannerResult | null =
  null;

function ScannerProbe() {
  const api = useBarcodeScanner();
  scanner = api;

  return (
    <div ref={api.viewportRef} />
  );
}

async function flush(
  times = 4,
): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, 0),
      );
    });
  }
}

beforeEach(() => {
  runtimeMock.state.reset();
  scanner = null;
});

describe("6.2B scanner hook lifecycle", () => {
  it("releases the session when the page is left while Start is still running", async () => {
    const view = render(
      <ScannerProbe />,
    );

    await flush(1);

    const startPromise =
      scanner?.start({
        preferredCamera:
          "WORLD_FACING",
      });

    // Let the queued start reach the provider and stay in flight.
    await flush(2);

    expect(
      runtimeMock.state.startCalls,
    ).toBe(1);
    expect(
      runtimeMock.state.stopCalls,
    ).toBe(0);

    view.unmount();

    // The provider only now finishes the startup the consumer walked away from.
    runtimeMock.state.pendingStart.resolve();
    await startPromise;
    await flush();

    expect(
      runtimeMock.state.stopCalls,
    ).toBe(1);
  });

  it("does not start anything when the page is left before the queued start runs", async () => {
    const view = render(
      <ScannerProbe />,
    );

    await flush(1);

    const startPromise =
      scanner?.start();

    view.unmount();

    runtimeMock.state.pendingStart.resolve();
    await startPromise;
    await flush();

    expect(
      runtimeMock.state.startCalls,
    ).toBe(0);
    expect(
      runtimeMock.state.stopCalls,
    ).toBe(0);
  });
});
