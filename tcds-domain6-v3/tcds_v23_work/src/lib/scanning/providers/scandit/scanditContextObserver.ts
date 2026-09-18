import type {
  ContextStatus,
  DataCaptureContext,
  DataCaptureContextListener,
} from '@scandit/web-datacapture-core';
import { assessScanditContextStatus, type ScanditContextStatusAssessment } from './scanditContextStatusMapper';

export type ScanditContextStatusListener = (
  assessment: ScanditContextStatusAssessment,
  rawStatus: ContextStatus,
) => void;

export function observeScanditContextStatus(
  context: DataCaptureContext,
  listener: ScanditContextStatusListener,
): () => void {
  const contextListener: DataCaptureContextListener = {
    didChangeStatus: (_context, status) => {
      listener(assessScanditContextStatus(status), status);
    },
  };

  context.addListener(contextListener);

  return () => {
    context.removeListener(contextListener);
  };
}
