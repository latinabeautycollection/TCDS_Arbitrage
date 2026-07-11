import { Link } from 'react-router-dom';
import { AlertTriangle, Box, PackageCheck, RotateCcw, ScanLine, Truck } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import { ScreenCard } from '../components/ScreenCard';
import { appRoutes } from '../config/routes';

const work = [
  { label: 'Receive', count: 12, path: '/receive', desc: 'New packages', icon: ScanLine },
  { label: 'Pick', count: 8, path: '/pick', desc: 'Sold items', icon: PackageCheck },
  { label: 'Ship', count: 5, path: '/pack-ship', desc: 'Ready to label', icon: Truck },
  { label: 'Returns', count: 2, path: '/returns', desc: 'Needs inspection', icon: RotateCcw },
  { label: 'Exceptions', count: 1, path: '/settings', desc: 'Supervisor review', icon: AlertTriangle }
];

export function Dashboard() {
  return <><AppHeader title="Dashboard" subtitle="Today’s warehouse command center" />
    <div className="mx-auto max-w-md space-y-4 p-4">
      <ScreenCard className="overflow-hidden p-0">
        <div className="bg-tcds-black p-5 text-white">
          <p className="text-[10px] font-black uppercase tracking-[0.30em] text-tcds-gold">Live Queue</p>
          <h2 className="mt-1 font-display text-3xl font-black tracking-tight">Today&apos;s Work</h2>
          <p className="mt-1 text-sm text-white/60">The system tells employees what matters next.</p>
        </div>
        <div className="space-y-2 p-4">
          {work.map(({ label, count, path, desc, icon: Icon }) => <Link key={label} to={path} className="enterprise-motion flex items-center justify-between rounded-2xl border border-tcds-line bg-white p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-tcds-surface text-tcds-gold"><Icon size={20} /></div>
              <div><p className="font-display text-lg font-black text-tcds-ink">{label}</p><p className="text-xs font-semibold text-tcds-muted">{desc}</p></div>
            </div>
            <p className="font-display text-3xl font-black text-tcds-gold">{count}</p>
          </Link>)}
        </div>
      </ScreenCard>
      <ScreenCard>
        <h2 className="mb-3 font-display text-lg font-black text-tcds-ink">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          {appRoutes.filter(r => ['/receive','/inventory','/pick','/pack-ship','/returns','/settings'].includes(r.path)).map(({ path, label, icon: Icon }) =>
            <Link key={path} to={path} className="enterprise-motion flex items-center gap-3 rounded-2xl border border-tcds-line bg-tcds-surface p-4 font-black text-tcds-ink"><Icon className="text-tcds-gold" size={20}/>{label}</Link>
          )}
        </div>
      </ScreenCard>
    </div></>;
}
