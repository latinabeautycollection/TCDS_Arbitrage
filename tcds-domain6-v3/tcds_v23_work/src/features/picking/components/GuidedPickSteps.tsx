import { CheckCircle2, Circle, MapPin, PackageCheck, ScanLine, ShieldCheck } from 'lucide-react';
import type { PickStep } from '../types/pickingTypes';

const steps: Array<{ key: PickStep; label: string; icon: typeof Circle }> = [
  { key: 'TRAVEL', label: 'Travel to location', icon: MapPin },
  { key: 'SCAN_LOCATION', label: 'Scan source location', icon: ScanLine },
  { key: 'SCAN_ITEM', label: 'Scan exact TCDS item', icon: PackageCheck },
  { key: 'CONFIRM_CONDITION', label: 'Confirm visible condition', icon: ShieldCheck },
  { key: 'SCAN_DESTINATION', label: 'Scan tote / pack stage', icon: ScanLine },
  { key: 'COMPLETE', label: 'Server completion gate', icon: CheckCircle2 },
];

export function GuidedPickSteps({ active }: { active: PickStep }) {
  const activeIndex = steps.findIndex((s) => s.key === active);
  return <div className="space-y-2">{steps.map((step, index) => {
    const complete = index < activeIndex;
    const current = index === activeIndex;
    const Icon = complete ? CheckCircle2 : step.icon;
    return <div key={step.key} className={`flex items-center gap-3 rounded-2xl border p-3 ${current ? 'border-tcds-gold bg-tcds-gold/10' : 'border-tcds-line bg-white'}`}>
      <Icon size={20} className={complete ? 'text-tcds-green' : current ? 'text-tcds-goldDeep' : 'text-tcds-muted'} />
      <div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-wide text-tcds-muted">Step {index + 1}</p><p className="font-black text-tcds-ink">{step.label}</p></div>
      <span className={`text-xs font-black ${complete ? 'text-tcds-green' : current ? 'text-tcds-goldDeep' : 'text-tcds-muted'}`}>{complete ? 'DONE' : current ? 'ACTIVE' : 'LOCKED'}</span>
    </div>;
  })}</div>;
}
