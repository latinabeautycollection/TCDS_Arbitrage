import {
  render,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ScannerRuntimeDiagnostics,
} from "../../src/components/scanning/ScannerRuntimeDiagnostics";
import type {
  BarcodeCaptureStatus,
} from "../../src/lib/scanning/capture/BarcodeCaptureStatus";
import type {
  ScannerRuntimeStatus,
} from "../../src/lib/scanning/contracts/ScannerRuntimeStatus";

const failedCapture: BarcodeCaptureStatus = {
  phase: "CAMERA_ERROR",
  provider: "scandit",
  permission: "ERROR",
  cameraOn: false,
  captureEnabled: false,
  viewAttached: false,
  torchAvailable: false,
  torchOn: false,
  zoomAvailable: false,
  backgroundSuspended: false,
  lastErrorCode: "CAMERA_NOT_READABLE",
  message:
    "The camera could not be opened or became unavailable.",
  lastChangedAt:
    new Date().toISOString(),
};

const blockedRuntime: ScannerRuntimeStatus = {
  phase: "BLOCKED",
  ready: false,
  degraded: false,
  blocked: true,
  blockingReason: "LICENSE_REJECTED",
  provider: "scandit",
  providerStatusCode: 9,
  providerStatusValid: false,
  providerStatusCategory: "LICENSE",
  message:
    "Scanner runtime is blocked by licence validation.",
  lastChangedAt:
    new Date().toISOString(),
};

describe("6.2B diagnostic status surface", () => {
  it("shows a readable failure instead of nothing", () => {
    const { container } = render(
      <ScannerRuntimeDiagnostics
        capture={failedCapture}
        runtime={blockedRuntime}
        metadata={{
          providerId: "scandit",
          providerName:
            "Scandit Data Capture SDK",
          providerVersion: "8.5.3",
          runtimeAssetVersion: "8.5.3",
          implementationVersion:
            "6.2B.1",
          capabilities: [
            "RUNTIME",
            "BARCODE_CAPTURE",
          ],
        }}
      />,
    );

    const text =
      container.textContent ?? "";

    // The states, categories and codes QA reads on the device.
    expect(text).toContain("BLOCKED");
    expect(text).toContain(
      "LICENSE_REJECTED",
    );
    expect(text).toContain("LICENSE");
    expect(text).toContain("ERROR");
    expect(text).toContain(
      "CAMERA_ERROR",
    );
    expect(text).toContain(
      "CAMERA_NOT_READABLE",
    );
    expect(text).toContain("8.5.3");
    expect(text).toContain(
      "6.2B_CERTIFICATION_DEFAULT",
    );

    // Nothing raw is rendered.
    expect(text).not.toContain(
      "[object",
    );
    expect(text).not.toContain(
      "licenseKey",
    );
  });

  it("still reports states when the runtime is not available yet", () => {
    const { container } = render(
      <ScannerRuntimeDiagnostics
        capture={failedCapture}
      />,
    );

    const text =
      container.textContent ?? "";

    expect(text).toContain(
      "Runtime state",
    );
    expect(text).toContain(
      "CAMERA_NOT_READABLE",
    );
    expect(text).toContain("—");
  });
});
