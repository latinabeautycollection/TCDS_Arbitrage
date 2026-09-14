import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/scanning/providers/scandit/scanditVersion', () => ({
  APPROVED_SCANDIT_VERSION: '8.5.2',
  assertApprovedScanditVersion: (version: string) => version,
}));

import {
  loadScanditRuntimeConfig,
  loadScanditStaticConfig,
} from '../../src/lib/scanning/providers/scandit/scanditConfig';

describe('scanditConfig', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('builds an exact same-origin versioned library path', () => {
    vi.stubEnv('VITE_SCANDIT_LIBRARY_BASE', '/scandit');
    vi.stubEnv('VITE_SCANDIT_RUNTIME_ENABLED', 'false');
    expect(loadScanditStaticConfig().libraryLocation)
      .toBe('/scandit/8.5.2/sdc-lib/');
  });

  it('rejects remote runtime locations', () => {
    vi.stubEnv('VITE_SCANDIT_LIBRARY_BASE', 'https://cdn.example.com/scandit');
    vi.stubEnv('VITE_SCANDIT_RUNTIME_ENABLED', 'false');
    expect(() => loadScanditStaticConfig()).toThrow(/remote/i);
  });

  it('rejects non-root-relative runtime locations', () => {
    vi.stubEnv('VITE_SCANDIT_LIBRARY_BASE', 'scandit');
    vi.stubEnv('VITE_SCANDIT_RUNTIME_ENABLED', 'false');
    expect(() => loadScanditStaticConfig()).toThrow(/root-relative/i);
  });

  it('allows metadata/static config without license', () => {
    vi.stubEnv('VITE_SCANDIT_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_SCANDIT_LICENSE_KEY', '');
    expect(loadScanditStaticConfig().sdkVersion).toBe('8.5.2');
  });

  it('requires license only for runtime initialization', () => {
    vi.stubEnv('VITE_SCANDIT_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_SCANDIT_LICENSE_KEY', '');
    expect(() => loadScanditRuntimeConfig()).toThrow(/license/i);
  });
});
