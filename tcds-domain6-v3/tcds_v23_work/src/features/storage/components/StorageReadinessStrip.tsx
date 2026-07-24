import { BrainCircuit, Database, Radio, ScanLine, Server, ShieldCheck, Warehouse } from 'lucide-react';
import type { PutAwayReadiness, ReadinessState } from '../types/storageTypes';
function tone(state: ReadinessState): string { return state === 'READY' ? 'text-tcds-green' : state === 'WARNING' ? 'text-tcds-warning' : state === 'BLOCKED' ? 'text-tcds-red' : 'text-tcds-muted'; }
export function StorageReadinessStrip({ readiness }: { readiness: PutAwayReadiness }) {
  const rows = [
    { label: 'API', state: readiness.api, icon: Server }, { label: 'DB', state: readiness.database, icon: Database },
    { label: 'Scanner', state: readiness.scanner, icon: ScanLine }, { label: 'Station', state: readiness.station, icon: Warehouse },
    { label: 'Network', state: readiness.network, icon: Radio }, { label: 'AI', state: readiness.recommendationEngine, icon: BrainCircuit },
    { label: 'Audit', state: readiness.auditPipeline, icon: ShieldCheck },
  ];
  return <div className="grid grid-cols-4 gap-2" aria-label="Put-away readiness">{rows.map(({ label, state, icon: Icon }) => <div key={label} className="rounded-2xl border border-tcds-line bg-tcds-surface p-2 text-center"><Icon size={17} className={`mx-auto ${tone(state)}`}/><p className="mt-1 truncate text-[10px] font-black text-tcds-ink">{label}</p><p className={`text-[9px] font-black ${tone(state)}`}>{state}</p></div>)}</div>;
}
