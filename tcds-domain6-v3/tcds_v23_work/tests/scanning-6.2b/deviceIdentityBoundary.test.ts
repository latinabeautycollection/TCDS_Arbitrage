import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  BarcodeDecodeObservation,
} from "../../src/lib/scanning/capture/BarcodeDecodeObservation";

describe(
  "6.2B device identity boundary",
  () => {
    it(
      "keeps browser/provider camera IDs diagnostic-only",
      () => {
        const observation:
          BarcodeDecodeObservation = {
            observationId:
              "00000000-0000-4000-8000-000000000001",
            provider: "scandit",
            rawValue: "ABC123",
            symbology: "CODE128",
            capturedAt:
              new Date().toISOString(),
            deviceMetadata: {
              cameraDeviceId:
                "browser-camera-id",
              providerDeviceId:
                "provider-diagnostic-id",
            },
          };

        const serialized =
          JSON.stringify(
            observation,
          );

        expect(
          serialized,
        ).not.toContain(
          "warehouse_device_id",
        );
        expect(
          serialized,
        ).not.toContain(
          "asset_id",
        );
        expect(
          serialized,
        ).not.toContain(
          "device_session_id",
        );
      },
    );
  },
);
