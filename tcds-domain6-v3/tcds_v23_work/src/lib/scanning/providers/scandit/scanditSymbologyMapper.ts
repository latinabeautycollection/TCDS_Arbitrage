import {
  Symbology,
} from "@scandit/web-datacapture-barcode";
import type {
  WarehouseSymbology,
} from "../../capture/WarehouseSymbology";
import {
  BarcodeCaptureError,
} from "../../capture/BarcodeCaptureError";

export function toScanditSymbology(
  symbology: WarehouseSymbology,
): Symbology {
  switch (symbology) {
    case "CODE128":
      return Symbology.Code128;
    case "EAN13_UPCA":
      return Symbology.EAN13UPCA;
    case "QR":
      return Symbology.QR;
    default: {
      const exhaustive: never = symbology;
      throw new BarcodeCaptureError(
        "UNSUPPORTED_SYMBOLOGY",
        `Unsupported 6.2B certification symbology: ${String(exhaustive)}`,
        false,
      );
    }
  }
}

export function fromScanditSymbology(
  symbology: Symbology,
): WarehouseSymbology {
  switch (symbology) {
    case Symbology.Code128:
      return "CODE128";
    case Symbology.EAN13UPCA:
      return "EAN13_UPCA";
    case Symbology.QR:
      return "QR";
    default:
      throw new BarcodeCaptureError(
        "UNSUPPORTED_SYMBOLOGY",
        "Scandit decoded a symbology outside the 6.2B certification set.",
        false,
      );
  }
}
