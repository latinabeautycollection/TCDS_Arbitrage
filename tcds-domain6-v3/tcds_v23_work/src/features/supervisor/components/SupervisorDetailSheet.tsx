import { X } from 'lucide-react';
import type { SupervisorMessage } from '../types/supervisorTypes';
export function SupervisorDetailSheet({ message, onClose }: { message: SupervisorMessage | null; onClose: () => void }) {
  if (!message) return null;
  return <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-3" role="presentation" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="supervisor-message-title" onClick={e => e.stopPropagation()} className="mx-auto w-full max-w-md rounded-[2rem] bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[.22em] text-tcds-gold">{message.code}</p><h2 id="supervisor-message-title" className="mt-1 font-display text-section font-black text-tcds-ink">{message.title}</h2></div><button onClick={onClose} className="tcds-focus rounded-xl border border-tcds-line p-2" aria-label="Close details"><X size={18}/></button></div>
      <p className="mt-4 text-sm font-semibold leading-6 text-tcds-muted">{message.explanation}</p>
      <div className="mt-4 rounded-2xl bg-tcds-surface p-4"><p className="text-xs font-black uppercase tracking-[.18em] text-tcds-goldDeep">Required next step</p><p className="mt-2 text-sm font-black text-tcds-ink">{message.nextStep}</p></div>
      {message.supportReference && <p className="mt-4 text-xs font-semibold text-tcds-muted">Support reference: <span className="font-black text-tcds-ink">{message.supportReference}</span></p>}
      <button onClick={onClose} className="tcds-focus enterprise-motion mt-5 min-h-12 w-full rounded-2xl bg-tcds-black px-4 py-3 font-black text-white">Understood</button>
    </section>
  </div>;
}
