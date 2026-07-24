import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import type { ReadinessService } from '../types/supervisorTypes';
export function ReadinessMatrix({ services }: { services: ReadinessService[] }) {
  return <div className="grid grid-cols-2 gap-3">
    {services.map(service => {
      const Icon = service.state === 'ONLINE' ? CheckCircle2 : service.state === 'DEGRADED' ? AlertTriangle : service.state === 'OFFLINE' ? XCircle : CircleHelp;
      return <div key={service.key} className="rounded-2xl border border-tcds-line bg-tcds-surface p-3">
        <div className="flex items-center justify-between gap-2"><p className="font-black text-tcds-ink">{service.label}</p><Icon size={18} className={service.state === 'ONLINE' ? 'text-tcds-green' : service.state === 'DEGRADED' ? 'text-tcds-warning' : service.state === 'OFFLINE' ? 'text-tcds-red' : 'text-tcds-muted'} /></div>
        <p className="mt-1 text-xs font-semibold text-tcds-muted">{service.detail}</p>
        {service.blocking && <p className="mt-2 text-[10px] font-black uppercase tracking-[.15em] text-tcds-red">Workflow blocking</p>}
      </div>;
    })}
  </div>;
}
