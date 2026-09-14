import { describe, expect, it } from 'vitest';
import { assertRuntimeInvariant } from '../../src/lib/scanning/runtime/scannerRuntimeAssertions';

const base = {
  blockingReason: 'NONE' as const,
  provider: 'x',
  providerVersion: '1',
  runtimeAssetVersion: '1',
  degradationReasons: [] as string[],
  lastChangedAt: new Date().toISOString(),
};

describe('runtime invariants', () => {
  it('accepts READY with matching versions', () => {
    expect(() => assertRuntimeInvariant({
      ...base, phase: 'READY', ready: true, degraded: false, blocked: false,
    })).not.toThrow();
  });

  it('accepts operational DEGRADED state', () => {
    expect(() => assertRuntimeInvariant({
      ...base, phase: 'DEGRADED', ready: true, degraded: true, blocked: false,
      degradationReasons: ['WEBGL_UNAVAILABLE'],
    })).not.toThrow();
  });

  it('rejects READY with mismatched versions', () => {
    expect(() => assertRuntimeInvariant({
      ...base, phase: 'READY', ready: true, degraded: false, blocked: false,
      runtimeAssetVersion: '2',
    })).toThrow();
  });

  it('rejects ready=true outside READY/DEGRADED', () => {
    expect(() => assertRuntimeInvariant({
      ...base, phase: 'FAILED', ready: true, degraded: false, blocked: true,
    })).toThrow();
  });
});
