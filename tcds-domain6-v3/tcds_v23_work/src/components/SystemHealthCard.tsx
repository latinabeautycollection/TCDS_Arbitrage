import { Cloud, Database, Printer, RadioTower, Server, Wifi } from 'lucide-react';
import { ScreenCard } from './ScreenCard';

const services = [
  { label: 'Online', detail: 'Connected', icon: Wifi },
  { label: 'API', detail: 'Healthy', icon: Server },
  { label: 'PostgreSQL', detail: 'Available', icon: Database },
  { label: 'Scanner', detail: 'Ready', icon: RadioTower },
  { label: 'Printer', detail: 'Connected', icon: Printer },
  { label: 'Cloudflare R2', detail: 'Synced', icon: Cloud }
];

export function SystemHealthCard() {
  return (
    <ScreenCard>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-caption font-black uppercase tracking-[0.24em] text-tcds-gold">Infrastructure</p>
          <h2 className="mt-1 font-display text-section font-black text-tcds-ink">System Status</h2>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-caption font-black text-tcds-green">All systems operational</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {services.map(({ label, detail, icon: Icon }) => (
          <div key={label} className="rounded-enterprise border border-tcds-line bg-tcds-surface p-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-tcds-green shadow-[0_0_0_3px_rgba(24,122,69,.12)]" />
              <Icon size={15} className="text-tcds-gold" />
              <span className="font-display text-caption font-black text-tcds-ink">{label}</span>
            </div>
            <p className="mt-1 pl-6 text-caption font-semibold text-tcds-muted">{detail}</p>
          </div>
        ))}
      </div>
    </ScreenCard>
  );
}
