import {
  BarcodeCapture,
  BarcodeCaptureFeedback,
  BarcodeCaptureSettings,
  SelectionMode,
} from "@scandit/web-datacapture-barcode";
import {
  Feedback,
} from "@scandit/web-datacapture-core";
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

  const capture =
    await BarcodeCapture.forContext(
      context,
      settings,
    );

  // The SDK creates the mode already enabled and armed with its own success
  // feedback. Capture stays disabled until the controller reaches CAPTURING, so
  // a barcode that is already in view while the camera starts cannot decode
  // early or break Start.
  await capture.setEnabled(false);

  // The TCDS capture policy is the only feedback authority. The SDK's own beep
  // and vibration are cleared so nothing can emit outside that policy.
  const feedback =
    BarcodeCaptureFeedback.default;

  feedback.success = new Feedback(
    null,
    null,
  );

  await capture.setFeedback(feedback);

  return capture;
}
