import type { PackingStage } from '../types/packShipTypes';
const stages: Array<{ id: PackingStage; label: string }> = [
  { id: 'CONTENTS', label: 'Contents' }, { id: 'PACKAGING', label: 'Pack' }, { id: 'MEASUREMENTS', label: 'Measure' },
  { id: 'EVIDENCE', label: 'Evidence' }, { id: 'ADDRESS', label: 'Address' }, { id: 'RATES', label: 'Rate' },
  { id: 'CARRIER_LABEL', label: 'Label' }, { id: 'OUTBOUND', label: 'Stage' },
];
export function ProgressRail({ stage }: { stage: PackingStage }) {
  const active = Math.max(0, stages.findIndex((s) => s.id === stage));
  return <div className="flex gap-2 overflow-x-auto pb-1">
    {stages.map((s, i) => <div key={s.id} className={`min-w-[82px] rounded-2xl border px-3 py-2 text-center ${i < active ? 'border-tcds-green/20 bg-green-50' : i === active ? 'border-tcds-gold bg-tcds-gold/10' : 'border-tcds-line bg-white'}`}>
      <p className="text-[10px] font-black uppercase tracking-[.12em] text-tcds-muted">{i + 1}</p>
      <p className="text-xs font-black text-tcds-ink">{s.label}</p>
    </div>)}
  </div>;
}
