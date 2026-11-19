import { afterEach, describe, expect, it, vi } from "vitest";
import { packShipApi } from "../../src/features/packShip/services/packShipApi";
import type { PackShipLabelPairEvidence } from "../../src/features/packShip/scanning/packShipLabelEvidence";

afterEach(() => vi.unstubAllGlobals());

describe("Pack/Ship label verification evidence transport", () => {
  it("keeps the existing authoritative route and carries the deterministic physical pair evidence", async () => {
    let body: any;
    let headers: Record<string, string> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      headers = init.headers as Record<string, string>;
      return {
        ok: true,
        status: 200,
        json: async () => ({ taskId: "T1", rowVersion: 9, carrierLabel: {}, lastUpdatedAt: "2026-11-12T00:00:00Z" }),
        headers: { get: () => null },
      } as unknown as Response;
    }));

    const evidence: PackShipLabelPairEvidence = {
      labelPairId: "11111111-1111-4111-8111-111111111111",
      tracking: {
        labelPairId: "11111111-1111-4111-8111-111111111111",
        barcode: "1Z999",
        observationId: "OBS-T",
        capturedAt: "2026-11-12T00:00:00Z",
        provider: "scandit",
        symbology: "CODE128",
        trackingClientOperationId: "11111111-1111-4111-8111-111111111111",
        trackingCorrelationId: "22222222-2222-4222-8222-222222222222",
      },
      package: {
        observationId: "OBS-P",
        capturedAt: "2026-11-12T00:00:01Z",
        provider: "scandit",
        symbology: "CODE128",
        packageClientOperationId: "33333333-3333-4333-8333-333333333333",
        packageCorrelationId: "44444444-4444-4444-8444-444444444444",
      },
    };

    await packShipApi.verifyLabel(
      "S1",
      "1Z999",
      "PKG-1",
      {
        clientOperationId: "33333333-3333-4333-8333-333333333333",
        correlationId: "44444444-4444-4444-8444-444444444444",
      },
      evidence,
    );

    expect(body).toEqual({
      trackingBarcode: "1Z999",
      packageBarcode: "PKG-1",
      physicalEvidence: evidence,
    });
    expect(headers["Idempotency-Key"]).toBe("33333333-3333-4333-8333-333333333333");
    expect(headers["X-Correlation-ID"]).toBe("44444444-4444-4444-8444-444444444444");
  });
});
