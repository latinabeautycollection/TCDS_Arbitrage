import {
  describe,
  expect,
  it,
} from "vitest";
import {
  resolveWarehouseCapturePolicy,
} from "../../src/lib/scanning/policy/capturePolicyResolver";
import {
  authorityFixture,
} from "./fixtures";

describe(
  "6.2C certified configuration envelope",
  () => {
    it(
      "allows a safe Warehouse Control scan-area override",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            "PICK_ITEM",
            authorityFixture({
              configuration: {
                scanditWeb: {
                  scanArea: {
                    widthFraction:
                      0.75,
                    heightFraction:
                      0.40,
                  },
                },
              },
            }),
          );

        expect(
          result.executionPolicy
            .scanArea,
        ).toEqual({
          widthFraction: 0.75,
          heightFraction: 0.40,
        });
      },
    );

    it(
      "rejects unsafe scan-area widening",
      () => {
        expect(() =>
          resolveWarehouseCapturePolicy(
            "PICK_ITEM",
            authorityFixture({
              configuration: {
                scanditWeb: {
                  scanArea: {
                    widthFraction:
                      0.99,
                    heightFraction:
                      0.90,
                  },
                },
              },
            }),
          ),
        ).toThrowError(
          /scan area exceeds/,
        );
      },
    );

    it(
      "forces explicit confirmation when Warehouse Control disables auto scan",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            "PICK_ITEM",
            authorityFixture({
              autoScanEnabled:
                false,
            }),
          );

        expect(
          result.executionPolicy
            .selection,
        ).toBe(
          "EXPLICIT_CONFIRMATION",
        );
      },
    );

    it(
      "keeps serial capture explicit even when auto scan is enabled",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            "RETURN_SERIAL",
            authorityFixture({
              autoScanEnabled: true,
            }),
          );

        expect(
          result.executionPolicy
            .selection,
        ).toBe(
          "EXPLICIT_CONFIRMATION",
        );
      },
    );
  },
);
