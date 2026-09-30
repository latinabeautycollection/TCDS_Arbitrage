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
  "6.2C authoritative policy reconciliation",
  () => {
    it(
      "intersects Warehouse Control configuration with the context safety envelope",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            "PICK_LOCATION",
            authorityFixture(),
          );

        expect(
          result.executionPolicy
            .symbologies,
        ).toEqual([
          "CODE128",
          "QR",
        ]);
      },
    );

    it(
      "converts warehouse duplicate_suppression_ms to the 6.2B seconds contract",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            "PICK_ITEM",
            authorityFixture({
              duplicateSuppressionMs:
                750,
            }),
          );

        expect(
          result.executionPolicy
            .duplicateFilterSeconds,
        ).toBe(0.75);
      },
    );

    it(
      "carries complete policy lineage into the 6.2B execution contract",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            "RETURN_SERIAL",
            authorityFixture(),
          );

        expect(
          result.executionPolicy
            .lineage,
        ).toEqual({
          policySource:
            "6.2C_VALIDATED_POLICY",
          registryVersion:
            "6.2C.2",
          profileId:
            "RETURN_SERIAL",
          profileRevision: 1,
        });
      },
    );

    it(
      "contains no warehouse entity or business outcome fields",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            "PICK_ITEM",
            authorityFixture(),
          );

        const text =
          JSON.stringify(
            result.executionPolicy,
          );

        for (
          const forbidden of [
            "itemId",
            "locationId",
            "packageId",
            "pickTaskId",
            "accepted",
            "rejected",
            "warehouseStatus",
            "expectedBarcode",
          ]
        ) {
          expect(text).not.toContain(
            forbidden,
          );
        }
      },
    );
  },
);
