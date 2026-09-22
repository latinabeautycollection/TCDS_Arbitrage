import {
  describe,
  expect,
  it,
} from "vitest";
import {
  DOMAIN6_2B_SCAN_AREA,
} from "../../src/lib/scanning/providers/scandit/scanditDataCaptureView";

describe("6.2B viewport/scan-area alignment", () => {
  it("uses a centered 70% x 35% certification region", () => {
    expect(
      DOMAIN6_2B_SCAN_AREA.left +
      DOMAIN6_2B_SCAN_AREA.width +
      DOMAIN6_2B_SCAN_AREA.right,
    ).toBeCloseTo(1);

    expect(
      DOMAIN6_2B_SCAN_AREA.top +
      DOMAIN6_2B_SCAN_AREA.height +
      DOMAIN6_2B_SCAN_AREA.bottom,
    ).toBeCloseTo(1);

    expect(
      DOMAIN6_2B_SCAN_AREA.left,
    ).toBe(
      DOMAIN6_2B_SCAN_AREA.right,
    );

    expect(
      DOMAIN6_2B_SCAN_AREA.top,
    ).toBe(
      DOMAIN6_2B_SCAN_AREA.bottom,
    );
  });
});
