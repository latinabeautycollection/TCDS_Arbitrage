import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeWarehouseControlCaptureSnapshot,
  WarehouseControlHttpCaptureSnapshotSource,
} from "../../src/features/packShip/scanning/warehouseControlCaptureSnapshotSource";
import { CertifiedCapturePolicyAuthority } from "../../src/lib/scanning/workflow/policy/CapturePolicyAuthority";

afterEach(() => vi.unstubAllGlobals());

const payload = {
  scanner_profile: {
    asset_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    scanner_mode: "CAMERA",
    supported_symbologies: ["CODE128", "QR"],
    auto_scan_enabled: true,
    continuous_scan_enabled: false,
    aim_mode: "STANDARD",
    illumination_enabled: true,
    beep_enabled: true,
    vibration_enabled: true,
    duplicate_suppression_ms: 750,
    configuration: {},
    updated_at: "2026-11-12T00:00:00Z",
  },
  symbologies: [
    { symbology_code: "CODE128", enabled: true, supports_check_digit: false },
    { symbology_code: "QR", enabled: true, supports_check_digit: false },
  ],
};

describe("Warehouse Control production capture snapshot source", () => {
  it("decodes the server-derived snake_case v0.2-style snapshot into the certified 6.2C DTO", () => {
    const decoded = decodeWarehouseControlCaptureSnapshot(payload);
    expect(decoded.scannerProfile.assetId).toBe(payload.scanner_profile.asset_id);
    expect(decoded.scannerProfile.duplicateSuppressionMs).toBe(750);
    expect(decoded.symbologies.map((x) => x.symbologyCode)).toEqual(["CODE128", "QR"]);
  });

  it("sends no client-selected device, facility, station or employee identity", async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/v1/warehouse-control/scanner/capture-snapshot");
      expect(init.method).toBe("GET");
      expect(url).not.toMatch(/device|station|facility|employee/i);
      return {
        ok: true,
        status: 200,
        json: async () => payload,
      } as Response;
    });
    vi.stubGlobal("fetch", fetchSpy);

    const source = new WarehouseControlHttpCaptureSnapshotSource();
    const authority = new CertifiedCapturePolicyAuthority(source);
    const policy = await authority.resolveIntentPolicy(
      {
        intent: "SOURCE_ID",
        mode: "SINGLE",
        allowedSymbologies: ["CODE128", "QR"],
        allowManualFallback: true,
      },
      { workflow: "PACKING", workflowEntityId: "T1", workflowStep: "PACK_SOURCE" },
    );

    expect(policy.symbologies).toContain("CODE128");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fails closed on malformed authority data", () => {
    expect(() => decodeWarehouseControlCaptureSnapshot({ scannerProfile: {}, symbologies: [] }))
      .toThrow(/Missing/);
  });
});
