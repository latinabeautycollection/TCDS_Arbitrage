import { Activity, AlertTriangle, Clock3, PackageCheck, ShieldCheck } from 'lucide-react';

export function DesktopSupervisorRail() {
  return (
    <>
      <aside className="fixed left-[max(2rem,calc(50%-42rem))] top-28 hidden w-64 space-y-4 xl:block">
        <div className="rounded-enterprise border border-tcds-line bg-white p-5 shadow-card">
          <p className="text-caption font-black uppercase tracking-[0.24em] text-tcds-gold">Supervisor Console</p>
          <h2 className="mt-1 font-display text-section font-black">Warehouse Overview</h2>
          <div className="mt-4 space-y-3 text-body">
            <RailRow icon={PackageCheck} label="Orders on time" value="98.6%" />
            <RailRow icon={Clock3} label="Avg. cycle time" value="14m" />
            <RailRow icon={ShieldCheck} label="Audit health" value="Clean" />
          </div>
        </div>
      </aside>
      <aside className="fixed right-[max(2rem,calc(50%-42rem))] top-28 hidden w-64 space-y-4 xl:block">
        <div className="rounded-enterprise border border-tcds-line bg-white p-5 shadow-card">
          <p className="text-caption font-black uppercase tracking-[0.24em] text-tcds-gold">Live Activity</p>
          <h2 className="mt-1 font-display text-section font-black">Operations Feed</h2>
          <div className="mt-4 space-y-3">
            <ActivityItem icon={Activity} text="Inventory sync completed" time="1m" />
            <ActivityItem icon={PackageCheck} text="Pick PICK-00596 completed" time="4m" />
            <ActivityItem icon={AlertTriangle} text="1 exception awaiting review" time="8m" />
          </div>
        </div>
      </aside>
    </>
  );
}

function RailRow({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-enterprise bg-tcds-surface p-3"><span className="flex items-center gap-2 font-semibold text-tcds-muted"><Icon size={16} className="text-tcds-gold" />{label}</span><strong>{value}</strong></div>;
}

function ActivityItem({ icon: Icon, text, time }: { icon: typeof Activity; text: string; time: string }) {
  return <div className="flex items-start gap-3 rounded-enterprise bg-tcds-surface p-3"><Icon size={16} className="mt-0.5 shrink-0 text-tcds-gold" /><div className="min-w-0"><p className="text-caption font-black text-tcds-ink">{text}</p><p className="text-caption text-tcds-muted">{time} ago</p></div></div>;
}
