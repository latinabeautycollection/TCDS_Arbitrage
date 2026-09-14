import { Logger } from '@scandit/web-datacapture-core';
import type { ScanditRuntimeConfig } from './scanditConfig';

export function toScanditLogLevel(level: ScanditRuntimeConfig['logLevel']): Logger.Level {
  switch (level) {
    case 'debug': return Logger.Level.Debug;
    case 'info': return Logger.Level.Info;
    case 'warn': return Logger.Level.Warn;
    case 'error': return Logger.Level.Error;
    case 'off': return Logger.Level.Quiet;
    default: return Logger.Level.Warn;
  }
}
