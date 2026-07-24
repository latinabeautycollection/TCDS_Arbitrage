import { Database, Network, Route, ScanLine, Server, Warehouse } from 'lucide-react';
import type { PickReadiness, ReadinessState } from '../types/pickingTypes';

const tone: Record<ReadinessState, string> = {
  READY: 'text-tcds-green', DEGRADED: 'text-tcds-warning', OFFLINE: 'text-tcds-red', BLOCKED: 'text-tcds-red'
};

export function PickReadinessStrip({ readiness }: { readiness: PickReadiness }) {
  const items = [
    ['API', readiness.api, Server], ['DB', readiness.database, Database], ['Scanner', readiness.scanner, ScanLine],
    ['Station', readiness.station, Warehouse], ['Network', readiness.network, Network], ['Route', readiness.routeOptimizer, Route],
  ] as const;
  return <div className="grid grid-cols-3 gap-2 rounded-enterprise border border-tcds-line bg-white p-3 shadow-soft">
    {items.map(([label, state, Icon]) => <div key={label} className="rounded-xl bg-tcds-surface p-2 text-center">
      <Icon size={16} className={`mx-auto ${tone[state]}`} /><p className="mt-1 text-[10px] font-black uppercase tracking-wide text-tcds-muted">{label}</p><p className={`text-[10px] font-black ${tone[state]}`}>{state}</p>
    </div>)}
  </div>;
}
