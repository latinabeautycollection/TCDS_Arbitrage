import { Crown, ShieldAlert, UserCheck } from 'lucide-react';
import type { OverrideLevel } from '../types/storageTypes';
export function OverrideReviewCard({ disabled, onRequest }: { disabled?: boolean; onRequest: (level: OverrideLevel, reason: string) => void }) {
  return <div className="rounded-enterprise border border-tcds-line bg-white p-4 shadow-soft">
    <div className="flex gap-3"><ShieldAlert className="text-tcds-warning"/><div><h3 className="font-display text-card font-black">Controlled Review & Override</h3><p className="text-xs font-semibold text-tcds-muted">Original recommendations, scans, safety findings, and audit evidence remain immutable.</p></div></div>
    <div className="mt-3 grid grid-cols-3 gap-2">
      {([['MANAGER', UserCheck], ['SUPERVISOR', ShieldAlert], ['EXECUTIVE', Crown]] as const).map(([level, Icon]) => <button key={level} disabled={disabled} onClick={() => {
        const reason = window.prompt(`${level} review reason (required)` )?.trim();
        if (reason) onRequest(level, reason);
      }} className="tcds-focus min-h-14 rounded-2xl border border-tcds-line bg-tcds-surface px-2 text-[10px] font-black text-tcds-ink disabled:opacity-40"><Icon size={17} className="mx-auto mb-1 text-tcds-goldDeep"/>{level}</button>)}
    </div>
    <p className="mt-3 text-[10px] font-bold text-tcds-red">Safety, hazard, wrong-item, active-hold, and capacity-overrun failures cannot be overridden.</p>
  </div>;
}
