import { AlertTriangle, Info, ShieldAlert, XCircle } from 'lucide-react';
import type { PackShipMessage } from '../types/packShipMessages';

export function WorkflowMessageBanner({ message, onPrimary, onSecondary, onDetails }: { message: PackShipMessage; onPrimary?: () => void; onSecondary?: () => void; onDetails?: () => void }) {
  const critical = message.severity === 'CRITICAL';
  const error = message.severity === 'ERROR';
  const tone = critical || error ? 'border-red-200 bg-red-50' : message.severity === 'WARNING' ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50';
  const color = critical || error ? 'text-tcds-red' : message.severity === 'WARNING' ? 'text-tcds-warning' : 'text-blue-700';
  const Icon = critical ? ShieldAlert : error ? XCircle : message.severity === 'WARNING' ? AlertTriangle : Info;
  return <section role="alert" aria-live="assertive" className={`rounded-2xl border p-4 ${tone}`}>
    <div className="flex items-start gap-3"><Icon className={`mt-0.5 shrink-0 ${color}`} size={20}/><div className="min-w-0 flex-1"><p className={`font-black ${color}`}>{message.title}</p><p className="mt-1 text-sm text-tcds-ink">{message.explanation}</p><p className="mt-2 text-sm font-bold text-tcds-ink">Next step: {message.nextAction}</p>{message.supportReference && <p className="mt-2 text-xs font-semibold text-tcds-muted">Reference: {message.supportReference}</p>}</div></div>
    <div className="mt-3 flex flex-wrap gap-2">{message.primaryActionLabel && <button onClick={onPrimary} className="min-h-11 rounded-xl bg-tcds-black px-4 text-sm font-black text-white">{message.primaryActionLabel}</button>}{message.secondaryActionLabel && <button onClick={onSecondary} className="min-h-11 rounded-xl border border-tcds-line bg-white px-4 text-sm font-black">{message.secondaryActionLabel}</button>}{onDetails && <button onClick={onDetails} className="min-h-11 rounded-xl px-3 text-sm font-black text-tcds-goldDeep">Why is this blocked?</button>}</div>
  </section>;
}
