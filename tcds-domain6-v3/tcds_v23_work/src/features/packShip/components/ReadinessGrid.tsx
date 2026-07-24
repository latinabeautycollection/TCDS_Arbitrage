import type { PackShipReadiness } from '../types/packShipTypes';

export function ReadinessGrid({ readiness }: { readiness: PackShipReadiness }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {Object.entries(readiness).map(([key, value]) => <div key={key} className="rounded-2xl border border-tcds-line bg-white px-3 py-2 shadow-soft">
      <p className="text-[10px] font-black uppercase tracking-[.15em] text-tcds-muted">{key}</p>
      <p className={`mt-1 text-xs font-black ${value === 'READY' ? 'text-tcds-green' : value === 'DEGRADED' ? 'text-tcds-warning' : 'text-tcds-red'}`}>{value}</p>
    </div>)}
  </div>;
}
