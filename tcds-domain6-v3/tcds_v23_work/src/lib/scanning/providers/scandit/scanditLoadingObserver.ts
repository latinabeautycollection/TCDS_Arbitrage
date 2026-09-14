import { loadingStatus, type ProgressInfo } from '@scandit/web-datacapture-core';

export interface ScanditLoadProgress { percentage?: number; loadedBytes?: number; }

export function subscribeToScanditLoading(listener: (progress: ScanditLoadProgress) => void): () => void {
  // Scandit's loadingStatus.subscribe() returns void. A subscriber can only be removed by
  // passing the same function reference to loadingStatus.unsubscribe(), so keep it here.
  const subscriber = (info: ProgressInfo): void => {
    // Scandit types ProgressInfo.percentage as number | null. The provider-neutral
    // ScanditLoadProgress contract uses an optional number, so the SDK-specific null
    // is normalized to undefined here, at the adapter boundary.
    listener({ percentage: info.percentage ?? undefined, loadedBytes: info.loadedBytes });
  };

  loadingStatus.subscribe(subscriber);

  return () => {
    loadingStatus.unsubscribe(subscriber);
  };
}
