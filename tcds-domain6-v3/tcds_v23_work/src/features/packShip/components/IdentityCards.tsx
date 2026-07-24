import { Barcode, Box, Truck } from 'lucide-react';
import type { PackShipTask } from '../types/packShipTypes';
export function IdentityCards({ task }: { task: PackShipTask }) {
  const itemBarcode = task.items[0]?.internalBarcode || 'Pending';
  return <div className="grid gap-2 sm:grid-cols-3">
    <Identity icon={<Barcode size={18}/>} label="Item identity" value={itemBarcode} />
    <Identity icon={<Box size={18}/>} label="Package identity" value={task.packageBarcode || 'Created after packing'} />
    <Identity icon={<Truck size={18}/>} label="Carrier tracking" value={task.carrierLabel.trackingNumber || 'Created after purchase'} />
  </div>;
}
function Identity({ icon, label, value }: { icon: JSX.Element; label: string; value: string }) {
  return <div className="rounded-2xl border border-tcds-line bg-white p-3 shadow-soft"><div className="flex items-center gap-2 text-tcds-gold">{icon}<span className="text-[10px] font-black uppercase tracking-[.15em] text-tcds-muted">{label}</span></div><p className="mt-2 break-all text-xs font-black text-tcds-ink">{value}</p></div>;
}
