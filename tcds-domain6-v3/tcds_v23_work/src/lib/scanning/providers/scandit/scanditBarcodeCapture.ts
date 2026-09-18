import {
  SelectionMode,
} from "@scandit/web-datacapture-core";
import {
  BarcodeCapture,
  BarcodeCaptureSettings,
} from "@scandit/web-datacapture-barcode";
import type {
  DataCaptureContext,
} from "@scandit/web-datacapture-core";

import {
  DOMAIN6_2B_CERTIFICATION_POLICY,
  type BarcodeCaptureExecutionPolicy,
} from "../../capture/BarcodeCaptureCapability";
import {
  toScanditSymbology,
} from "./scanditSymbologyMapper";

export async function createScanditBarcodeCapture(
  context: DataCaptureContext,
  policy:
    BarcodeCaptureExecutionPolicy =
      DOMAIN6_2B_CERTIFICATION_POLICY,
): Promise<BarcodeCapture> {
  const settings =
    new BarcodeCaptureSettings();

  settings.enableSymbologies(
    policy.symbologies.map(
      toScanditSymbology,
    ),
  );

  settings.codeDuplicateFilter =
    policy.duplicateFilterSeconds;

  settings.selectionMode =
    policy.selection ===
    "EXPLICIT_CONFIRMATION"
      ? SelectionMode.On
      : SelectionMode.Off;

  return BarcodeCapture.forContext(
    context,
    settings,
  );
}
