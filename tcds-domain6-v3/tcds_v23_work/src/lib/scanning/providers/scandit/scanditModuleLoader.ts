import { barcodeCaptureLoader } from '@scandit/web-datacapture-barcode';

/** Loads only the future barcode module; 6.2A MUST NOT instantiate BarcodeCapture. */
export function createScanditModuleLoaders() {
  return [barcodeCaptureLoader()];
}
