import {
  describe,
  expect,
  it,
} from "vitest";
import type {
  CaptureCleanupFailure,
} from "../../src/lib/scanning/capture/BarcodeCaptureError";
import {
  BarcodeCaptureError,
} from "../../src/lib/scanning/capture/BarcodeCaptureError";

describe("6.2B cleanup contract", () => {
  it("carries failed release steps instead of silently reporting STOPPED", () => {
    const failures: CaptureCleanupFailure[] = [
      {
        step: "STOP_CAMERA",
        message: "camera refused to stop",
      },
      {
        step: "CLEAR_FRAME_SOURCE",
        message: "context still attached",
      },
    ];

    const error =
      new BarcodeCaptureError(
        "CAPTURE_CLEANUP_FAILED",
        "Cleanup incomplete",
        true,
        failures,
        failures,
      );

    expect(
      error.cleanupFailures,
    ).toHaveLength(2);

    expect(
      error.cleanupFailures?.map(
        (failure) => failure.step,
      ),
    ).toEqual([
      "STOP_CAMERA",
      "CLEAR_FRAME_SOURCE",
    ]);
  });
});
