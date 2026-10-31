import { describe, expect, it } from "vitest";
import {
  createWarehouseClientOperation,
  operationHeaders,
} from "../../src/lib/scanning/workflow/operation/WarehouseClientOperation";

describe("6.2D operation identity", () => {
  it("reuses correlation/idempotency across retry while request ID changes", () => {
    const op = createWarehouseClientOperation();
    const a = operationHeaders(op, "REQ-A") as Record<string, string>;
    const b = operationHeaders(op, "REQ-B") as Record<string, string>;

    expect(a["Idempotency-Key"]).toBe(b["Idempotency-Key"]);
    expect(a["X-Correlation-ID"]).toBe(b["X-Correlation-ID"]);
    expect(a["X-Request-ID"]).not.toBe(b["X-Request-ID"]);
  });
});
