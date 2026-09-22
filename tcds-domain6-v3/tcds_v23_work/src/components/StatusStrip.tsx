import { CheckCircle2, Cloud, Printer, RadioTower, Server, Wifi } from 'lucide-react';
import { ScannerDiagnosticsEntry } from './scanning/ScannerDiagnosticsEntry';

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
        {statuses.map(({ label, icon: Icon }) => {
          const chip = (
            <span className="flex items-center gap-1 whitespace-nowrap">
              <CheckCircle2 size={11} className="text-tcds-green" /> <Icon size={12} className="text-tcds-gold" /> {label}
            </span>
          );

          // Press and hold the scanner chip to reach the scanner diagnostic
          // surface. It stays unlabelled and signed-in only, so it is a way in
          // for certification testing on an installed PWA, not a feature.
          return label === 'Scanner'
            ? <ScannerDiagnosticsEntry key={label}>{chip}</ScannerDiagnosticsEntry>
            : <span key={label} className="contents">{chip}</span>;
        })}
      </div>
    </div>
  );
}
