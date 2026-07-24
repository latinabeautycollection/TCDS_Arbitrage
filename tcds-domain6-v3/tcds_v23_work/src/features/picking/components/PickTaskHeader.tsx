import { Clock3, PackageCheck, UserRound, Warehouse } from 'lucide-react';
import type { PickTask } from '../types/pickingTypes';

export function PickTaskHeader({ task }: { task: PickTask }) {
  return <div className="overflow-hidden rounded-[1.6rem] border border-tcds-line bg-tcds-black text-white shadow-soft">
    <div className="border-b border-white/10 p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="text-caption font-black uppercase tracking-[0.24em] text-tcds-gold">Authorized Pick</p><h2 className="mt-1 font-display text-card font-black">{task.taskNumber}</h2><p className="mt-1 text-sm text-white/60">Order {task.orderNumber}</p></div><span className="rounded-full bg-tcds-gold px-3 py-1 text-xs font-black text-tcds-black">{task.priority}</span></div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-tcds-gold" style={{ width: `${Math.max(8, Math.round((task.progressCurrent / task.progressTotal) * 100))}%` }} /></div>
      <p className="mt-2 text-xs font-black text-white/70">Item {task.progressCurrent} of {task.progressTotal} · {task.mode.replace('_', ' ')}</p>
    </div>
    <div className="grid grid-cols-2 gap-2 p-4 text-xs">
      <Meta icon={UserRound} label="Picker" value={task.employeeDisplayName} /><Meta icon={Warehouse} label="Facility" value={task.facilityCode} />
      <Meta icon={Clock3} label="Claim expires" value={new Date(task.claimExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} /><Meta icon={PackageCheck} label="Pack destination" value={task.packDestinationCode} />
    </div>
  </div>;
}

function Meta({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
  return <div className="rounded-2xl bg-white/8 p-3"><Icon size={16} className="text-tcds-gold"/><p className="mt-2 text-white/45">{label}</p><p className="mt-1 font-black text-white">{value}</p></div>;
}
