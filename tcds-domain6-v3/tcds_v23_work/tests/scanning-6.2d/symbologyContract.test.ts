import { describe, expect, it } from "vitest";
import { DOMAIN6_2D_CERTIFIED_SYMBOLOGIES } from "../../src/lib/scanning/workflow/contracts/WarehouseCaptureIntent";

describe("6.2D symbology contract", () => {
  it("does not exceed the current certified 6.2B set", () => {
    expect(DOMAIN6_2D_CERTIFIED_SYMBOLOGIES).toEqual(["CODE128", "EAN13_UPCA", "QR"]);
  });
});
