import { Gauge, Scale, Warehouse } from 'lucide-react';
import type { CapacitySnapshot } from '../types/storageTypes';

export function CapacityLedgerCard({ capacity }: { capacity: CapacitySnapshot }) {
  const unitsPct = capacity.capacityUnits ? Math.min(100, Math.round(((capacity.committedUnits + capacity.reservedUnits) / capacity.capacityUnits) * 100)) : 0;
  return <div className="rounded-enterprise border border-tcds-line bg-tcds-surface p-3">
    <div className="flex items-center justify-between"><p className="text-xs font-black text-tcds-ink">Live Capacity Ledger</p><p className="text-[10px] font-bold text-tcds-muted">Reconciled {new Date(capacity.reconciledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div>
    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
      <div><Warehouse size={15} className="mx-auto text-tcds-gold"/><p className="mt-1 text-[10px] font-bold text-tcds-muted">Available units</p><p className="font-black">{capacity.availableUnits ?? '—'}</p></div>
      <div><Scale size={15} className="mx-auto text-tcds-gold"/><p className="mt-1 text-[10px] font-bold text-tcds-muted">Available weight</p><p className="font-black">{capacity.availableWeightOz ? `${capacity.availableWeightOz.toFixed(1)} oz` : '—'}</p></div>
      <div><Gauge size={15} className="mx-auto text-tcds-gold"/><p className="mt-1 text-[10px] font-bold text-tcds-muted">Utilization</p><p className="font-black">{unitsPct}%</p></div>
    </div>
  </div>;
}
