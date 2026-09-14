import type { ScannerCapabilityReport } from '../contracts/ScannerCapabilityReport';

function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function detectScannerCapabilities(): ScannerCapabilityReport {
  const reasons: string[] = [];
  const degradedReasons: string[] = [];

  const secureContext = typeof window !== 'undefined' && window.isSecureContext === true;
  const webAssembly = typeof WebAssembly !== 'undefined';
  const webWorkers = typeof Worker !== 'undefined';
  const blob = typeof Blob !== 'undefined';
  const objectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  const mediaDevices = typeof navigator !== 'undefined' && navigator.mediaDevices !== undefined;
  const getUserMedia = mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
  const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  const offscreenCanvas = typeof OffscreenCanvas !== 'undefined';
  const webGL = supportsWebGL();

  if (!secureContext) reasons.push('SECURE_CONTEXT_UNAVAILABLE');
  if (!webAssembly) reasons.push('WEBASSEMBLY_UNAVAILABLE');
  if (!webWorkers) reasons.push('WEB_WORKERS_UNAVAILABLE');
  if (!blob) reasons.push('BLOB_UNAVAILABLE');
  if (!objectUrl) reasons.push('OBJECT_URL_UNAVAILABLE');

  // Optional acceleration features: absence does not block 6.2A,
  // but it is operationally meaningful and must be visible.
  if (!webGL) degradedReasons.push('WEBGL_UNAVAILABLE');
  if (!offscreenCanvas) degradedReasons.push('OFFSCREEN_CANVAS_UNAVAILABLE');

  // SharedArrayBuffer is informational for 6.2A/6.2B single-barcode capture.
  // It becomes a stronger requirement for later multithread/multi-barcode slices.
  if (!sharedArrayBuffer) degradedReasons.push('SHARED_ARRAY_BUFFER_UNAVAILABLE_INFORMATIONAL');

  const supported = secureContext && webAssembly && webWorkers && blob && objectUrl;

  return {
    supported,
    degraded: supported && degradedReasons.some((reason) => reason !== 'SHARED_ARRAY_BUFFER_UNAVAILABLE_INFORMATIONAL'),
    secureContext,
    webAssembly,
    webWorkers,
    blob,
    objectUrl,
    mediaDevices,
    getUserMedia,
    sharedArrayBuffer,
    offscreenCanvas,
    webGL,
    hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'SERVER',
    reasons,
    degradedReasons,
  };
}
