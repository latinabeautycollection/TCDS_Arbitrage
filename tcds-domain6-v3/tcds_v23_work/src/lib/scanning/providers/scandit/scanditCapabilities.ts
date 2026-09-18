import { BrowserHelper } from '@scandit/web-datacapture-core';
import type { ScannerCapabilityReport } from '../../contracts/ScannerCapabilityReport';

export function enrichWithScanditCompatibility(
  report: ScannerCapabilityReport,
): ScannerCapabilityReport {
  const compatibility = BrowserHelper.checkBrowserCompatibility();
  const missingFeatures = compatibility.missingFeatures.map((feature) => String(feature));

  return {
    ...report,
    providerCompatibility: {
      fullSupport: compatibility.fullSupport,
      scannerSupport: compatibility.scannerSupport,
      missingFeatures,
    },
  };
}
