import { describe, expect, it, vi } from "vitest";
import { bindPackShipManualOperation } from "../../src/features/packShip/scanning/packShipManualOperation";

describe("manual/HID logical operation identity", () => {
  it("reuses the same operation and payload binding across retry", async () => {
    const seen: Array<{ id: string; correlation: string; barcode: string }> = [];
    const barcode = "TCDS-ITEM-1";
    const bound = bindPackShipManualOperation(async (operation) => {
      seen.push({ id: operation.clientOperationId, correlation: operation.correlationId, barcode });
      if (seen.length === 1) throw new Error("NETWORK_ERROR");
      return "ok";
    });

    await expect(bound.run()).rejects.toThrow("NETWORK_ERROR");
    await expect(bound.run()).resolves.toBe("ok");

    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(seen[0]);
  });

  it("creates a new identity for a new logical operation", () => {
    const a = bindPackShipManualOperation(vi.fn(async () => undefined));
    const b = bindPackShipManualOperation(vi.fn(async () => undefined));
    expect(a.operation.clientOperationId).not.toBe(b.operation.clientOperationId);
  });
});
