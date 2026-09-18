import {
  describe,
  expect,
  it,
} from "vitest";
import {
  mapScanditCaptureError,
} from "../../src/lib/scanning/providers/scandit/scanditCaptureErrors";

describe("Scandit camera error mapping", () => {
  it("maps permission denial", () => {
    const error = new DOMException(
      "Denied",
      "NotAllowedError",
    );

    expect(
      mapScanditCaptureError(error).code,
    ).toBe("CAMERA_PERMISSION_DENIED");
  });

  it("maps missing camera", () => {
    const error = new DOMException(
      "Missing",
      "NotFoundError",
    );

    expect(
      mapScanditCaptureError(error).code,
    ).toBe("CAMERA_UNAVAILABLE");
  });

  it("maps unreadable camera", () => {
    const error = new DOMException(
      "Busy",
      "NotReadableError",
    );

    expect(
      mapScanditCaptureError(error).code,
    ).toBe("CAMERA_NOT_READABLE");
  });
});
