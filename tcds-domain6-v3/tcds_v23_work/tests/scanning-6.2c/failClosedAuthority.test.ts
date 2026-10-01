import {
  describe,
  expect,
  it,
} from "vitest";
import {
  resolveWarehouseCapturePolicy,
} from "../../src/lib/scanning/policy/capturePolicyResolver";
import {
  CapturePolicyError,
} from "../../src/lib/scanning/policy/CapturePolicyError";
import {
  authorityFixture,
} from "./fixtures";

describe(
  "6.2C fail-closed authority rules",
  () => {
    it(
      "rejects a HID keyboard scanner profile for the Scandit camera path",
      () => {
        expect(() =>
          resolveWarehouseCapturePolicy(
            "PICK_ITEM",
            authorityFixture({
              scannerMode:
                "HID_KEYBOARD",
            }),
          ),
        ).toThrow(
          CapturePolicyError,
        );
      },
    );

    it(
      "rejects continuous scanning because 6.2B pauses after every decode",
      () => {
        expect(() =>
          resolveWarehouseCapturePolicy(
            "PICK_ITEM",
            authorityFixture({
              continuousScanEnabled:
                true,
            }),
          ),
        ).toThrowError(
          /continuous_scan_enabled/,
        );
      },
    );

    it(
      "rejects Warehouse Control symbologies not supported by 6.2B",
      () => {
        expect(() =>
          resolveWarehouseCapturePolicy(
            "PICK_ITEM",
            authorityFixture({
              supportedSymbologies: [
                "CODE128",
                "PDF417",
              ],
            }),
          ),
        ).toThrowError(
          /does not support/,
        );
      },
    );

    it(
      "rejects a policy with no effective enabled symbologies",
      () => {
        const authority =
          authorityFixture();

        const disabled = {
          ...authority,
          symbologies:
            authority.symbologies.map(
              (item) => ({
                ...item,
                enabled: false,
              }),
            ),
        };

        expect(() =>
          resolveWarehouseCapturePolicy(
            "PICK_ITEM",
            disabled,
          ),
        ).toThrowError(
          /No effective barcode symbologies/,
        );
      },
    );
  },
);
