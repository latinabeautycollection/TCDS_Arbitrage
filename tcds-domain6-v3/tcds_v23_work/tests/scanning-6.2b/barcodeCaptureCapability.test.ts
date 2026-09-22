import {
  describe,
  expect,
  it,
} from "vitest";
import {
  hasBarcodeCaptureCapability,
} from "../../src/lib/scanning/capture/BarcodeCaptureCapability";

describe("BarcodeCaptureCapability guard", () => {
  it("rejects a runtime-only provider", () => {
    expect(
      hasBarcodeCaptureCapability({
        initialize() {},
        dispose() {},
      }),
    ).toBe(false);
  });

  it("accepts the complete provider-neutral capture contract", () => {
    const provider = {
      start() {},
      pause() {},
      resume() {},
      stop() {},
      getCaptureStatus() {},
      subscribeToScans() {},
      subscribeToCaptureStatus() {},
      suspendForBackground() {},
      resumeFromBackground() {},
      setTorch() {},
    };

    expect(
      hasBarcodeCaptureCapability(provider),
    ).toBe(true);
  });
});
