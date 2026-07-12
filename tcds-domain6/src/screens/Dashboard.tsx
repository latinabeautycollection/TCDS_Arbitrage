import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, PackageCheck, RotateCcw, ScanLine, Truck } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import { ScreenCard } from '../components/ScreenCard';
import { SystemHealthCard } from '../components/SystemHealthCard';
import { appRoutes } from '../config/routes';

const work = [
  { label: 'Receive', count: 12, path: '/receive', desc: 'New packages waiting', updated: 'Updated 2 min ago', action: 'Open Receiving', icon: ScanLine },
  { label: 'Pick', count: 8, path: '/pick', desc: 'Sold items ready', updated: 'Updated 1 min ago', action: 'Open Pick Queue', icon: PackageCheck },
  { label: 'Ship', count: 5, path: '/pack-ship', desc: 'Packed and ready to label', updated: 'Updated 3 min ago', action: 'Open Shipping', icon: Truck },
  { label: 'Returns', count: 2, path: '/returns', desc: 'Items needing inspection', updated: 'Updated 6 min ago', action: 'Open Returns', icon: RotateCcw },
  { label: 'Exceptions', count: 1, path: '/settings', desc: 'Supervisor review required', updated: 'Updated 8 min ago', action: 'Review Exception', icon: AlertTriangle }
];

export function Dashboard() {
  return <><AppHeader title="Dashboard" subtitle="Today’s warehouse command center" />
    <div className="mx-auto max-w-md space-y-5 p-4">
      <div className="px-1">
        <p className="font-display text-card font-black text-tcds-ink">Good morning, Anthony</p>
        <p className="mt-1 text-body font-medium text-tcds-muted">Here is what requires attention across warehouse operations.</p>
      </div>

      <ScreenCard className="overflow-hidden p-0">
        <div className="relative overflow-hidden bg-tcds-black p-6 text-white">
          <div className="absolute -right-10 -top-12 h-44 w-44 bg-[url('/tcds-logo.svg')] bg-contain bg-no-repeat opacity-[.07]" aria-hidden="true" />
          <p className="relative text-caption font-black uppercase tracking-[0.30em] text-tcds-gold">Live Queue</p>
          <h2 className="relative mt-2 font-display text-display font-black">Today&apos;s Operations</h2>
          <p className="relative mt-2 text-body text-white/65">The system prioritizes what employees should process next.</p>
        </div>
        <div className="space-y-3 p-4">
          {work.map(({ label, count, path, desc, updated, action, icon: Icon }) => (
            <Link key={label} to={path} className="enterprise-motion block rounded-enterprise border border-tcds-line bg-white p-4 shadow-surface hover:border-tcds-gold/40 hover:shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-enterprise bg-tcds-surface text-tcds-gold"><Icon size={21} /></div>
                  <div className="min-w-0">
                    <p className="font-display text-card font-black text-tcds-ink">{label}</p>
                    <p className="mt-0.5 text-caption font-semibold text-tcds-muted">{desc}</p>
                    <p className="mt-2 text-caption font-semibold text-neutral-500">{updated}</p>
                  </div>
                </div>
                <p className="font-display text-page font-black text-tcds-gold">{count}</p>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-tcds-line pt-3 text-caption font-black text-tcds-ink">
                <span>{action}</span><ArrowRight size={16} className="text-tcds-gold" />
              </div>
            </Link>
          ))}
        </div>
      </ScreenCard>

      <SystemHealthCard />

      <ScreenCard>
        <h2 className="mb-3 font-display text-section font-black text-tcds-ink">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          {appRoutes.filter(r => ['/receive','/inventory','/pick','/pack-ship','/returns','/settings'].includes(r.path)).map(({ path, label, icon: Icon }) =>
            <Link key={path} to={path} className="enterprise-motion flex min-h-14 items-center gap-3 rounded-enterprise border border-tcds-line bg-tcds-surface p-4 font-display text-caption font-black text-tcds-ink hover:border-tcds-gold/40"><Icon className="text-tcds-gold" size={20}/>{label}</Link>
          )}
        </div>
      </ScreenCard>
    </div></>;
}
