import { AlertTriangle, Info } from 'lucide-react';
import type { PackShipMessage } from '../types/packShipMessages';
export function InlineFieldGuidance({ message }: { message?: PackShipMessage | null }) {
  if (!message) return null;
  const warning = message.severity === 'WARNING';
  return <div role="alert" className={`mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 ${warning ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>{warning ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-tcds-warning"/> : <Info size={16} className="mt-0.5 shrink-0 text-tcds-red"/>}<div><p className="text-xs font-black text-tcds-ink">{message.title}</p><p className="text-xs text-tcds-muted">{message.nextAction}</p></div></div>;
}
