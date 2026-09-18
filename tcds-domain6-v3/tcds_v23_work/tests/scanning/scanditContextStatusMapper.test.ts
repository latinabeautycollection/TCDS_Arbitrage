import { describe, expect, it } from 'vitest';
import type { ContextStatus } from '@scandit/web-datacapture-core';
import { assessScanditContextStatus } from '../../src/lib/scanning/providers/scandit/scanditContextStatusMapper';

function status(code: number, isValid: boolean, message = ''): ContextStatus {
  return { code, isValid, message } as ContextStatus;
}

describe('assessScanditContextStatus', () => {
  it('maps success structurally', () => {
    const result = assessScanditContextStatus(status(1, true));
    expect(result.category).toBe('SUCCESS');
    expect(result.phase).toBe('READY');
  });

  it('maps expired license deterministically', () => {
    const result = assessScanditContextStatus(status(13, false, 'expired'));
    expect(result.errorCode).toBe('LICENSE_EXPIRED');
    expect(result.phase).toBe('BLOCKED');
    expect(result.retryable).toBe(false);
  });

  it('maps missing resources as retryable runtime failure', () => {
    const result = assessScanditContextStatus(status(28, false, 'resource missing'));
    expect(result.errorCode).toBe('MISSING_RESOURCE');
    expect(result.blockingReason).toBe('RUNTIME_ASSETS_UNAVAILABLE');
    expect(result.retryable).toBe(true);
  });

  it('maps disposed contexts as application defects', () => {
    const result = assessScanditContextStatus(status(1025, false));
    expect(result.errorCode).toBe('DISPOSED_CONTEXT');
    expect(result.category).toBe('APPLICATION');
  });

  it('maps subscription range without message parsing', () => {
    const result = assessScanditContextStatus(status(131674, false, 'anything'));
    expect(result.errorCode).toBe('SUBSCRIPTION_ERROR');
    expect(result.category).toBe('SUBSCRIPTION');
  });

  it('redacts obvious license-key message content', () => {
    const result = assessScanditContextStatus(
      status(18, false, 'License key: abcdef-super-secret-value'),
    );
    expect(result.sanitizedMessage).not.toContain('abcdef-super-secret-value');
  });
});
