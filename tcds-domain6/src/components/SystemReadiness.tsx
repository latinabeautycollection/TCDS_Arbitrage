import { CheckCircle2, CircleAlert, Printer, RadioTower, Server, Wifi } from 'lucide-react';

type ReadinessItem = { label: string; ok: boolean; icon: typeof Wifi };

export function SystemReadiness({ compact = false }: { compact?: boolean }) {
  const items: ReadinessItem[] = [
    { label: 'Online', ok: true, icon: Wifi },
    { label: 'Server Connected', ok: true, icon: Server },
    { label: 'Printer Connected', ok: true, icon: Printer },
    { label: 'Scanner Ready', ok: true, icon: RadioTower }
  ];

  return (
    <div className={`rounded-executive border border-tcds-line bg-white ${compact ? 'p-3' : 'p-4'} shadow-executive`}>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="flex items-center gap-2 rounded-2xl bg-tcds-surface px-3 py-3 text-xs font-black text-tcds-ink">
              {item.ok ? <CheckCircle2 size={15} className="text-tcds-green" /> : <CircleAlert size={15} className="text-tcds-warning" />}
              <Icon size={15} className="text-tcds-gold" />
              <span>{item.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
