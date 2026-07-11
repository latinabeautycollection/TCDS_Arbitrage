import { CheckCircle2, Cloud, Printer, RadioTower, Server, Wifi } from 'lucide-react';

const statuses = [
  { label: 'Online', icon: Wifi },
  { label: 'Server', icon: Server },
  { label: 'Printer', icon: Printer },
  { label: 'Scanner', icon: RadioTower },
  { label: 'Sync', icon: Cloud }
];

export function StatusStrip() {
  return (
    <div className="safe-bottom fixed bottom-0 left-0 right-0 z-30 border-t border-tcds-gold/20 bg-tcds-black px-3 py-2 text-white shadow-[0_-10px_35px_rgba(0,0,0,.22)]">
      <div className="mx-auto flex max-w-md items-center justify-between gap-2 text-[10px] font-black">
        {statuses.map(({ label, icon: Icon }) => (
          <span key={label} className="flex items-center gap-1 whitespace-nowrap">
            <CheckCircle2 size={11} className="text-tcds-green" /> <Icon size={12} className="text-tcds-gold" /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}
