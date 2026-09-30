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
import type {
  WarehouseControlCaptureAuthoritySnapshot,
} from "../../src/lib/scanning/policy/WarehouseControlCaptureSnapshot";
import {
  authorityFixture,
} from "./fixtures";

function capture(
  run: () => unknown,
): CapturePolicyError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(
      CapturePolicyError,
    );

    return error as CapturePolicyError;
  }

  throw new Error(
    "expected the policy resolution to fail closed",
  );
}

describe(
  "6.2C authoritative scanner identity",
  () => {
    it(
      "requires an authoritative Warehouse Control asset identity",
      () => {
        const error = capture(() =>
          resolveWarehouseCapturePolicy(
            "PICK_ITEM",
            authorityFixture({
              assetId: "   ",
            }),
          ),
        );

        expect(error.code).toBe(
          "SCANNER_ASSET_ID_REQUIRED",
        );
      },
    );

    it(
      "requires an authoritative configuration snapshot at all",
      () => {
        const error = capture(() =>
          resolveWarehouseCapturePolicy(
            "PICK_ITEM",
            undefined as unknown as
              WarehouseControlCaptureAuthoritySnapshot,
          ),
        );

        expect(error.code).toBe(
          "AUTHORITY_SNAPSHOT_REQUIRED",
        );
      },
    );

    it(
      "carries the authority evidence into the resolved policy",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            "PICK_ITEM",
            authorityFixture(),
          );

        expect(
          result.authorityEvidence
            .scannerAssetId,
        ).toBe(
          "00000000-0000-4000-8000-000000000001",
        );
      },
    );
  },
);

describe(
  "6.2C context envelope narrows only",
  () => {
    it(
      "never adds a symbology the authoritative profile does not configure",
      () => {
        // The PICK_LOCATION envelope allows CODE128 and QR, and the database
        // fixture enables both. The authoritative profile configures CODE128
        // alone, so QR must not appear: the envelope is a ceiling, never a
        // source of capability.
        const result =
          resolveWarehouseCapturePolicy(
            "PICK_LOCATION",
            authorityFixture({
              supportedSymbologies: [
                "CODE128",
              ],
            }),
          );

        expect(
          result.executionPolicy
            .symbologies,
        ).toEqual([
          "CODE128",
        ]);
      },
    );
  },
);
