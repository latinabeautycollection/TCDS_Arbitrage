import {
  describe,
  expect,
  it,
} from "vitest";
import {
  assertCaptureTransition,
} from "../../src/lib/scanning/capture/captureStateMachine";

describe("6.2B capture state machine", () => {
  it("allows the normal capture path", () => {
    expect(() => {
      assertCaptureTransition("IDLE", "CAMERA_REQUESTED");
      assertCaptureTransition("CAMERA_REQUESTED", "PERMISSION_PENDING");
      assertCaptureTransition("PERMISSION_PENDING", "CAMERA_STARTING");
      assertCaptureTransition("CAMERA_STARTING", "READY");
      assertCaptureTransition("READY", "CAPTURING");
      assertCaptureTransition("CAPTURING", "DECODED");
      assertCaptureTransition("DECODED", "PAUSED");
      assertCaptureTransition("PAUSED", "CAPTURING");
      assertCaptureTransition("CAPTURING", "STOPPED");
    }).not.toThrow();
  });

  it("rejects impossible transitions", () => {
    expect(() =>
      assertCaptureTransition("IDLE", "DECODED"),
    ).toThrow(/Invalid capture state transition/);
  });
});
