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
        expect(
          scanAreaMarginsFor({
            widthFraction: 0.70,
            heightFraction: 0.35,
          }),
        ).toEqual({
          left: 0.15,
          right: 0.15,
          top: 0.325,
          bottom: 0.325,
        });
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
