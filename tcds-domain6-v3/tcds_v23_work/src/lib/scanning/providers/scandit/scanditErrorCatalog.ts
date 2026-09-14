import { ScannerProviderError, type ScannerProviderErrorCode } from '../../contracts/ScannerProviderError';
import type { ScanditContextStatusAssessment } from './scanditContextStatusMapper';

export function errorFromContextAssessment(
  assessment: ScanditContextStatusAssessment,
): ScannerProviderError | null {
  if (!assessment.errorCode) return null;
  return new ScannerProviderError(
    assessment.errorCode,
    assessment.sanitizedMessage || 'Scanner provider context is invalid.',
    assessment.retryable,
    'scandit',
    assessment.code,
  );
}

function classifyFallback(error: unknown): { code: ScannerProviderErrorCode; retryable: boolean } {
  const raw = error instanceof Error ? error.message : String(error);
  const m = raw.toLowerCase();

  // Message matching is deliberately LAST-RESORT only for errors thrown
  // before ContextStatus becomes available (module loading/configuration).
  if (m.includes('license')) return { code: 'LICENSE_REJECTED', retryable: false };
  if (m.includes('wasm') || m.includes('library') || m.includes('asset') || m.includes('404')) {
    return { code: 'RUNTIME_ASSET_NOT_FOUND', retryable: true };
  }
  if (m.includes('version')) return { code: 'RUNTIME_VERSION_MISMATCH', retryable: false };
  if (m.includes('network') || m.includes('fetch')) return { code: 'SDK_LOAD_FAILED', retryable: true };
  return { code: 'UNKNOWN_PROVIDER_ERROR', retryable: false };
}

export function mapScanditError(error: unknown): ScannerProviderError {
  if (error instanceof ScannerProviderError) return error;
  const mapping = classifyFallback(error);
  return new ScannerProviderError(
    mapping.code,
    'Scanner provider initialization failed.',
    mapping.retryable,
    'scandit',
    undefined,
    error,
  );
}
