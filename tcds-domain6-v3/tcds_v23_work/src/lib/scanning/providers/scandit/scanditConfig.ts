import { APPROVED_SCANDIT_VERSION, assertApprovedScanditVersion } from './scanditVersion';

export interface ScanditStaticConfig {
  enabled: boolean;
  sdkVersion: string;
  libraryLocation: string;
  logLevel: 'off' | 'error' | 'warn' | 'info' | 'debug';
}

export interface ScanditRuntimeConfig extends ScanditStaticConfig {
  licenseKey: string;
}

function getBaseConfig(): ScanditStaticConfig {
  const sdkVersion = assertApprovedScanditVersion(APPROVED_SCANDIT_VERSION);
  const enabled = import.meta.env.VITE_SCANDIT_RUNTIME_ENABLED !== 'false';
  const libraryBase = String(import.meta.env.VITE_SCANDIT_LIBRARY_BASE ?? '/scandit').replace(/\/+$/, '');
  const configured = String(import.meta.env.VITE_SCANDIT_LOG_LEVEL ?? 'warn').toLowerCase();
  const allowed = new Set(['off', 'error', 'warn', 'info', 'debug']);
  const logLevel = (allowed.has(configured) ? configured : 'warn') as ScanditStaticConfig['logLevel'];

  if (/^https?:\/\//i.test(libraryBase)) {
    throw new Error('Remote Scandit runtime locations are prohibited by 6.2A governance.');
  }
  if (!libraryBase.startsWith('/')) {
    throw new Error('Scandit runtime library base must be same-origin and root-relative.');
  }

  return {
    enabled,
    sdkVersion,
    libraryLocation: `${libraryBase}/${sdkVersion}/sdc-lib/`,
    logLevel,
  };
}

export function loadScanditStaticConfig(): ScanditStaticConfig {
  return getBaseConfig();
}

export function loadScanditRuntimeConfig(): ScanditRuntimeConfig {
  const base = getBaseConfig();
  const licenseKey = String(import.meta.env.VITE_SCANDIT_LICENSE_KEY ?? '').trim();

  if (base.enabled && !licenseKey) {
    throw new Error('Scandit runtime enabled but license configuration is missing.');
  }

  return { ...base, licenseKey };
}
