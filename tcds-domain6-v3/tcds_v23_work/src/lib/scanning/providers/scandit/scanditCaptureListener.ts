import type {
  BarcodeCapture,
  BarcodeCaptureListener,
  BarcodeCaptureSession,
} from "@scandit/web-datacapture-barcode";
import {
  DataCaptureContext,
} from "@scandit/web-datacapture-core";
import type {
  BarcodeDecodeObservation,
} from "../../capture/BarcodeDecodeObservation";
import {
  fromScanditSymbology,
} from "./scanditSymbologyMapper";

export interface ScanditDecodedPrimitives {
  observation: BarcodeDecodeObservation;
  frameSequenceId: number;
}

export function createScanditCaptureListener(
  onDecoded: (
    result: ScanditDecodedPrimitives,
    capture: BarcodeCapture,
  ) => void,
): BarcodeCaptureListener {
  return {
    didScan: (
      capture: BarcodeCapture,
      session: BarcodeCaptureSession,
    ): void => {
      const barcode = session.newlyRecognizedBarcode;
      if (!barcode) return;

      const text =
        barcode.data ?? barcode.rawData;

      // Copy all needed primitives while inside the callback.
      // Session/Barcode SDK objects never cross the provider boundary.
      const observation: BarcodeDecodeObservation = {
        observationId: crypto.randomUUID(),
        provider: "scandit",
        rawValue: text,
        symbology: fromScanditSymbology(
          barcode.symbology,
        ),
        capturedAt: new Date().toISOString(),
        deviceMetadata: {
          providerDeviceId:
            DataCaptureContext.deviceID || undefined,
        },
      };

      onDecoded(
        {
          observation,
          frameSequenceId:
            session.frameSequenceID,
        },
        capture,
      );
    },
  };
}
