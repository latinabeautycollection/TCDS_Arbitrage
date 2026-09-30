import type {
  WarehouseSymbology,
} from "../capture/WarehouseSymbology";

function normalize(
  value: string,
): string {
  return value
    .trim()
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      "",
    );
}

/**
 * Maps authoritative warehouse_control.barcode_symbologies codes into the
 * provider-neutral symbology vocabulary that 6.2B currently supports.
 *
 * Unsupported Warehouse Control symbologies are not silently widened into
 * Scandit behavior. They remain unsupported until 6.2B explicitly adds the
 * capability in a separately reviewed capture-engine change.
 */
export function mapWarehouseControlSymbology(
  code: string,
): WarehouseSymbology | null {
  switch (normalize(code)) {
    case "CODE128":
      return "CODE128";

    case "EAN13UPCA":
    case "EAN13":
    case "UPCA":
      return "EAN13_UPCA";

    case "QR":
    case "QRCODE":
      return "QR";

    default:
      return null;
  }
}
