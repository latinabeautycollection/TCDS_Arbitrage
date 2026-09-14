import { describe, expect, it } from 'vitest';
import { detectScannerCapabilities } from '../../src/lib/scanning/runtime/scannerCapabilityDetector';

describe('scannerCapabilityDetector', () => {
  it('returns a provider-neutral report', () => {
    const report = detectScannerCapabilities();
    expect(report).toHaveProperty('supported');
    expect(report).toHaveProperty('degraded');
    expect(report).toHaveProperty('webAssembly');
    expect(report).toHaveProperty('degradedReasons');
    expect(report).not.toHaveProperty('scandit');
  });
});
