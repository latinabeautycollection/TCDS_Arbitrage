import {
  render,
  screen,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock(
  "../../src/hooks/useBarcodeScanner",
  () => ({
    useBarcodeScanner: () => ({
      viewportRef: () => undefined,
      status: {
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
      },
      observation: null,
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      setTorch: vi.fn(),
      clearObservation: vi.fn(),
    }),
  }),
);

import {
  ScannerCaptureDiagnosticPage,
} from "../../src/pages/diagnostics/ScannerCaptureDiagnosticPage";

describe("6.2B diagnostic surface", () => {
  it("states that scans are non-authoritative", () => {
    render(<ScannerCaptureDiagnosticPage />);

    expect(
      screen.getByText(
        /decoded barcode is an observation, not a warehouse decision/i,
      ),
    ).toBeTruthy();

    expect(
      screen.getByRole("button", {
        name: /start scanner/i,
      }),
    ).toBeTruthy();
  });
});
