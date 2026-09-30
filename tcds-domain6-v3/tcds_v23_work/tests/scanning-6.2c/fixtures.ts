import type {
  WarehouseControlCaptureAuthoritySnapshot,
} from "../../src/lib/scanning/policy/WarehouseControlCaptureSnapshot";

export function authorityFixture(
  overrides: Partial<
    WarehouseControlCaptureAuthoritySnapshot["scannerProfile"]
  > = {},
): WarehouseControlCaptureAuthoritySnapshot {
  return {
    scannerProfile: {
      assetId:
        "00000000-0000-4000-8000-000000000001",
      scannerMode:
        "SCANDIT_WEB",
      supportedSymbologies: [
        "CODE128",
        "EAN13_UPCA",
        "QR",
      ],
      autoScanEnabled: true,
      continuousScanEnabled: false,
      aimMode: null,
      illuminationEnabled: null,
      beepEnabled: true,
      vibrationEnabled: true,
      duplicateSuppressionMs: 750,
      configuration: {},
      updatedAt:
        "2026-08-31T20:00:00.000Z",
      ...overrides,
    },
    symbologies: [
      {
        symbologyCode:
          "CODE128",
        enabled: true,
        supportsCheckDigit: false,
      },
      {
        symbologyCode:
          "EAN13_UPCA",
        enabled: true,
        supportsCheckDigit: true,
      },
      {
        symbologyCode:
          "QR",
        enabled: true,
        supportsCheckDigit: false,
      },
    ],
  };
}
