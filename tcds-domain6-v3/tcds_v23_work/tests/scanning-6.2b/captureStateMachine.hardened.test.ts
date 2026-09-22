import {
  describe,
  expect,
  it,
} from "vitest";
import {
  assertCaptureTransition,
  isCaptureTransitionAllowed,
} from "../../src/lib/scanning/capture/captureStateMachine";

describe("6.2B hardened capture state machine", () => {
  it.each([
    ["CAMERA_REQUESTED", "CAPTURE_ERROR"],
    ["PERMISSION_PENDING", "CAPTURE_ERROR"],
    ["CAMERA_STARTING", "CAPTURE_ERROR"],
    ["READY", "CAMERA_ERROR"],
    ["PAUSED", "CAMERA_ERROR"],
    ["RECOVERING", "CAMERA_UNAVAILABLE"],
  ] as const)(
    "allows %s -> %s so primary provider failures are never masked",
    (from, to) => {
      expect(
        isCaptureTransitionAllowed(
          from,
          to,
        ),
      ).toBe(true);

      expect(() =>
        assertCaptureTransition(
          from,
          to,
        ),
      ).not.toThrow();
    },
  );

  it("still rejects false business-style success transitions", () => {
    expect(() =>
      assertCaptureTransition(
        "IDLE",
        "DECODED",
      ),
    ).toThrow();
  });
});
