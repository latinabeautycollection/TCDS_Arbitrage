import {
  describe,
  expect,
  it,
} from "vitest";
import {
  scanAreaMarginsFor,
} from "../../src/lib/scanning/providers/scandit/scanditDataCaptureView";

describe(
  "6.2B scan-area policy execution",
  () => {
    it(
      "converts a centered 70 x 35 percent area into symmetric margins",
      () => {
        const margins =
          scanAreaMarginsFor({
            widthFraction: 0.70,
            heightFraction: 0.35,
          });

        expect(margins.left).toBeCloseTo(0.15, 10);
        expect(margins.right).toBeCloseTo(0.15, 10);
        expect(margins.top).toBeCloseTo(0.325, 10);
        expect(margins.bottom).toBeCloseTo(0.325, 10);
      },
    );

    it(
      "fails invalid scan-area policy",
      () => {
        expect(() =>
          scanAreaMarginsFor({
            widthFraction: 1.1,
            heightFraction: 0.35,
          }),
        ).toThrow();
      },
    );
  },
);
