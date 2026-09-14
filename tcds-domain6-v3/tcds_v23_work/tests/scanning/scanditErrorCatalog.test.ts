import { describe, expect, it } from 'vitest';
import { errorFromContextAssessment, mapScanditError } from '../../src/lib/scanning/providers/scandit/scanditErrorCatalog';

describe('scanditErrorCatalog', () => {
  it('prefers structured context assessment', () => {
    const error = errorFromContextAssessment({
      code: 17,
      isValid: false,
      category: 'LICENSE',
      phase: 'BLOCKED',
      blockingReason: 'LICENSE_REJECTED',
      errorCode: 'LICENSE_SDK_VERSION_INVALID',
      retryable: false,
      sanitizedMessage: 'invalid sdk version',
    });
    expect(error?.code).toBe('LICENSE_SDK_VERSION_INVALID');
    expect(error?.providerStatusCode).toBe(17);
  });

  it('uses message matching only as fallback before context status exists', () => {
    expect(mapScanditError(new Error('failed to fetch wasm asset')).code)
      .toBe('RUNTIME_ASSET_NOT_FOUND');
  });

  it('attaches only a redacted cause, never the raw Scandit exception', () => {
    const raw = new Error('Could not load https://host.example.com/scandit/8.5.2/sdc-lib/engine.wasm');
    const mapped = mapScanditError(raw);

    expect(mapped.code).toBe('RUNTIME_ASSET_NOT_FOUND');
    expect(mapped.cause).not.toBe(raw);
    expect(mapped.cause).not.toBeInstanceOf(Error);
    expect(mapped.cause).toEqual({ name: 'Error', message: 'Could not load [redacted]' });
  });
});
