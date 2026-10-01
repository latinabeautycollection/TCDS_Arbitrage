import {
  describe,
  expect,
  it,
} from "vitest";
import {
  mapWarehouseControlSymbology,
} from "../../src/lib/scanning/policy/warehouseControlSymbologyMapper";

describe(
  "6.2C Warehouse Control symbology mapping",
  () => {
    it.each([
      ["CODE128", "CODE128"],
      ["code_128", "CODE128"],
      ["EAN13_UPCA", "EAN13_UPCA"],
      ["EAN13", "EAN13_UPCA"],
      ["UPC_A", "EAN13_UPCA"],
      ["QR", "QR"],
      ["QR_CODE", "QR"],
    ] as const)(
      "maps %s to %s",
      (
        source,
        expected,
      ) => {
        expect(
          mapWarehouseControlSymbology(
            source,
          ),
        ).toBe(expected);
      },
    );

    it(
      "does not invent support for an unsupported symbology",
      () => {
        expect(
          mapWarehouseControlSymbology(
            "PDF417",
          ),
        ).toBeNull();
      },
    );
  },
);
