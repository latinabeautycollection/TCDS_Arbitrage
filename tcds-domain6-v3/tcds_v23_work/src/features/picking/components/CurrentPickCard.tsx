import { BatteryCharging, Box, Gem, MapPin, ShieldCheck } from 'lucide-react';
import type { PickItemInstruction } from '../types/pickingTypes';

export function CurrentPickCard({ item, next }: { item: PickItemInstruction; next?: PickItemInstruction }) {
  return <div className="space-y-3">
    <div className="rounded-[1.6rem] border border-tcds-gold/40 bg-white p-4 shadow-card">
      <p className="text-caption font-black uppercase tracking-[0.24em] text-tcds-goldDeep">Current Item</p>
      <h3 className="mt-2 font-display text-card font-black text-tcds-ink">{item.title}</h3><p className="mt-1 font-mono text-sm font-black text-tcds-muted">{item.internalBarcode}</p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm"><Info icon={MapPin} label="Location" value={item.locationCode}/><Info icon={Box} label="Quantity" value={String(item.quantity)}/><Info icon={ShieldCheck} label="Condition" value={item.condition}/><Info icon={Gem} label="Serial" value={item.serialSuffix ? `…${item.serialSuffix}` : 'Not serialized'}/></div>
      <div className="mt-3 flex flex-wrap gap-2">{item.highValue && <Flag icon={Gem} text="High value"/>}{item.fragile && <Flag icon={ShieldCheck} text="Fragile"/>}{item.batteryRestricted && <Flag icon={BatteryCharging} text="Battery controls"/>}</div>
    </div>
    {next && <div className="rounded-enterprise border border-tcds-line bg-tcds-surface p-3"><p className="text-xs font-black uppercase tracking-wide text-tcds-muted">Next Item</p><p className="mt-1 font-black text-tcds-ink">{next.title}</p><p className="text-sm text-tcds-muted">{next.locationCode}</p></div>}
  </div>;
}
function Info({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) { return <div className="rounded-2xl bg-tcds-surface p-3"><Icon size={16} className="text-tcds-gold"/><p className="mt-2 text-xs font-semibold text-tcds-muted">{label}</p><p className="font-black text-tcds-ink">{value}</p></div>; }
function Flag({ icon: Icon, text }: { icon: typeof Gem; text: string }) { return <span className="inline-flex items-center gap-1 rounded-full border border-tcds-gold/30 bg-tcds-gold/10 px-2 py-1 text-xs font-black text-tcds-goldDeep"><Icon size={13}/>{text}</span>; }
