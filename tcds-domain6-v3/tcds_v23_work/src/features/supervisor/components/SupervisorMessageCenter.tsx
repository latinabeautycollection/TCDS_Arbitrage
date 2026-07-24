import { AlertCircle, AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import type { SupervisorMessage } from '../types/supervisorTypes';

const severityOrder = { EMERGENCY: 0, CRITICAL: 1, ERROR: 2, WARNING: 3, INFO: 4 } as const;

export function SupervisorMessageCenter({ messages, onSelect }: { messages: SupervisorMessage[]; onSelect: (message: SupervisorMessage) => void }) {
  const ordered = [...messages].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  if (!ordered.length) return null;
  const blocking = ordered.filter(m => m.blocking).length;
  return <section aria-live="assertive" className="rounded-enterprise border border-red-200 bg-red-50 p-4 shadow-card">
    <div className="flex items-start gap-3">
      <ShieldAlert className="mt-0.5 shrink-0 text-tcds-red" size={22}/>
      <div className="min-w-0 flex-1">
        <p className="font-display text-card font-black text-tcds-ink">{blocking ? `${blocking} blocking issue${blocking === 1 ? '' : 's'} require attention` : 'Operational guidance'}</p>
        <p className="mt-1 text-sm text-tcds-muted">Resolve issues in safety, integrity, identity, authorization, evidence, then operational order.</p>
      </div>
    </div>
    <div className="mt-3 space-y-2">
      {ordered.slice(0, 4).map(message => {
        const Icon = message.severity === 'EMERGENCY' || message.severity === 'CRITICAL' ? ShieldAlert : message.severity === 'ERROR' ? AlertCircle : message.severity === 'WARNING' ? AlertTriangle : Info;
        return <button key={`${message.code}-${message.supportReference ?? ''}`} onClick={() => onSelect(message)} className="tcds-focus enterprise-motion flex w-full items-start gap-3 rounded-2xl border border-white bg-white p-3 text-left shadow-surface">
          <Icon size={18} className={message.severity === 'EMERGENCY' || message.severity === 'CRITICAL' || message.severity === 'ERROR' ? 'text-tcds-red' : message.severity === 'WARNING' ? 'text-tcds-warning' : 'text-tcds-blue'} />
          <span className="min-w-0"><span className="block font-black text-tcds-ink">{message.title}</span><span className="mt-0.5 block text-xs font-semibold text-tcds-muted">{message.nextStep}</span></span>
        </button>;
      })}
    </div>
  </section>;
}
