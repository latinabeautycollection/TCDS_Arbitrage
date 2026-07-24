import { AlertTriangle, BatteryCharging, ChevronRight, MapPin, ShieldAlert } from 'lucide-react';
import type { InventoryListItem } from '../types/inventoryTypes';
import { DigitalTwinHealth } from './DigitalTwinHealth';
import { InventoryStatusBadge } from './InventoryStatusBadge';

export function InventoryItemCard({ item, onOpen }: { item: InventoryListItem; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="tcds-focus enterprise-motion w-full rounded-enterprise border border-tcds-line bg-white p-4 text-left shadow-card">
      <div className="flex gap-3">
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-tcds-surface">
          {item.primaryPhotoUrl ? <img src={item.primaryPhotoUrl} alt="" className="h-full w-full object-cover" /> : <span className="font-display text-xs font-black text-tcds-gold">TCDS</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-black uppercase tracking-wide text-tcds-goldDeep">{item.internalBarcode}</p>
              <h3 className="mt-1 line-clamp-2 font-display text-card font-black text-tcds-ink">{item.title}</h3>
            </div>
            <ChevronRight size={18} className="mt-1 shrink-0 text-tcds-muted" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2"><InventoryStatusBadge status={item.effectiveStatus} /><span className="text-[11px] font-bold text-tcds-muted">{item.condition}</span></div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-tcds-surface p-2.5"><p className="font-bold text-tcds-muted">Location</p><p className="mt-0.5 flex items-center gap-1 font-black text-tcds-ink"><MapPin size={13} />{item.locationCode ?? 'Unassigned'}</p></div>
        <div className="rounded-xl bg-tcds-surface p-2.5"><p className="font-bold text-tcds-muted">Admission</p><p className="mt-0.5 truncate font-black text-tcds-ink">{item.provenance.replaceAll('_', ' ')}</p></div>
      </div>
      <div className="mt-3"><DigitalTwinHealth score={item.digitalTwinHealth} compact /></div>
      {item.flags.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{item.flags.slice(0, 4).map((flag) => <span key={flag} className="inline-flex items-center gap-1 rounded-full border border-tcds-line bg-white px-2 py-1 text-[10px] font-black text-tcds-muted">{flag.includes('BATTERY') ? <BatteryCharging size={11} /> : flag.includes('SAFETY') ? <ShieldAlert size={11} /> : <AlertTriangle size={11} />}{flag.replaceAll('_', ' ')}</span>)}</div>}
    </button>
  );
}
