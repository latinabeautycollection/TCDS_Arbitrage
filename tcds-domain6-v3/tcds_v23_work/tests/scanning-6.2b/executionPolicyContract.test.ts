import {
  describe,
  expect,
  it,
} from "vitest";

import {
  DOMAIN6_2B_CERTIFICATION_POLICY,
} from "../../src/lib/scanning/capture/BarcodeCaptureCapability";

describe(
  "6.2B permanent execution-policy seam",
  () => {
    it(
      "preserves a narrow certification default",
      () => {
        expect(
          DOMAIN6_2B_CERTIFICATION_POLICY
            .symbologies,
        ).toEqual([
          "CODE128",
          "EAN13_UPCA",
          "QR",
        ]);

        expect(
          DOMAIN6_2B_CERTIFICATION_POLICY
            .selection,
        ).toBe(
          "AUTOMATIC",
        );

        expect(
          DOMAIN6_2B_CERTIFICATION_POLICY
            .lineage
            ?.policySource,
        ).toBe(
          "6.2B_CERTIFICATION_DEFAULT",
        );
      },
    );

    it(
      "does not contain warehouse entity or decision authority",
      () => {
        const serialized =
          JSON.stringify(
            DOMAIN6_2B_CERTIFICATION_POLICY,
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
          ]
        ) {
          expect(
            serialized,
          ).not.toContain(
            forbidden,
          );
        }
      },
    );
  },
);
