import {
  describe,
  expect,
  it,
} from "vitest";

import {
  assessScanditContextStatus,
} from "../../src/lib/scanning/providers/scandit/scanditContextStatusMapper";

function status(
  code: number,
  isValid: boolean,
  message = "",
) {
  return {
    code,
    isValid,
    message,
  } as never;
}

describe("6.2B runtime error mapping", () => {
  it("never maps a camera runtime error to READY, even when the SDK reports the context as valid", () => {
    const assessment =
      assessScanditContextStatus(
        status(33794, true),
      );

    expect(assessment.phase).toBe(
      "FAILED",
    );
    expect(assessment.category).toBe(
      "CAMERA",
    );
    expect(assessment.errorCode).toBe(
      "CAMERA_RUNTIME_ERROR",
    );
    expect(assessment.isValid).toBe(
      false,
    );
  });

  it("never maps a licence rejection to READY, even when the SDK reports the context as valid", () => {
    const assessment =
      assessScanditContextStatus(
        status(9, true),
      );

    expect(assessment.phase).toBe(
      "BLOCKED",
    );
    expect(
      assessment.blockingReason,
    ).toBe("LICENSE_REJECTED");
  });

  it("still reports a healthy context as READY", () => {
    const healthy =
      assessScanditContextStatus(
        status(1, true),
      );

    expect(healthy.phase).toBe("READY");
    expect(healthy.category).toBe(
      "SUCCESS",
    );

    const unrecognised =
      assessScanditContextStatus(
        status(987654, true),
      );

    expect(unrecognised.phase).toBe(
      "READY",
    );
  });
});
