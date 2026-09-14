import { DataCaptureContext } from '@scandit/web-datacapture-core';
import { createScanditModuleLoaders } from './scanditModuleLoader';
import { toScanditLogLevel } from './scanditLogLevel';
import type { ScanditRuntimeConfig } from './scanditConfig';

export async function createScanditContext(config: ScanditRuntimeConfig): Promise<DataCaptureContext> {
  return DataCaptureContext.forLicenseKey(config.licenseKey, {
    libraryLocation: config.libraryLocation,
    moduleLoaders: createScanditModuleLoaders(),
    logLevel: toScanditLogLevel(config.logLevel),
  });
}
