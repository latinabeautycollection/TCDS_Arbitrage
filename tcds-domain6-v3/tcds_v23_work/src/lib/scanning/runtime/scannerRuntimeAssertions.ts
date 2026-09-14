import type { ScannerRuntimeStatus } from '../contracts/ScannerRuntimeStatus';

export function assertRuntimeInvariant(status: ScannerRuntimeStatus): void {
  const operational = status.phase === 'READY' || status.phase === 'DEGRADED';

  if (status.ready && !operational) {
    throw new Error('Scanner invariant violated: ready=true requires READY or DEGRADED phase.');
  }

  if (status.phase === 'READY' && status.degraded) {
    throw new Error('Scanner invariant violated: READY phase cannot have degraded=true.');
  }

  if (status.phase === 'DEGRADED' && (!status.ready || !status.degraded)) {
    throw new Error('Scanner invariant violated: DEGRADED requires ready=true and degraded=true.');
  }

  if (operational && (!status.providerVersion || !status.runtimeAssetVersion)) {
    throw new Error('Scanner invariant violated: operational state requires provider/runtime versions.');
  }

  if (
    operational &&
    status.providerVersion !== status.runtimeAssetVersion
  ) {
    throw new Error('Scanner invariant violated: provider/runtime versions must match.');
  }

  if (status.blocked && status.ready) {
    throw new Error('Scanner invariant violated: blocked runtime cannot be ready.');
  }
}
