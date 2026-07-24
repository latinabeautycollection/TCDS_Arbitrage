import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import type { ReturnMessage } from '../types/returnTypes';
export function ReturnMessageBanner({message,onDetails}:{message:ReturnMessage;onDetails:()=>void}){
 const Icon=message.severity==='CRITICAL'?ShieldAlert:message.severity==='INFO'?Info:AlertTriangle;
 return <div role={message.blocking?'alert':'status'} aria-live={message.blocking?'assertive':'polite'} className={`rounded-2xl border p-4 ${message.blocking?'border-red-300 bg-red-50':'border-tcds-gold/30 bg-tcds-gold/10'}`}>
  <div className="flex gap-3"><Icon className={message.blocking?'text-red-700':'text-tcds-goldDeep'} /><div className="min-w-0 flex-1"><p className="font-black text-tcds-ink">{message.title}</p><p className="mt-1 text-sm text-tcds-muted">{message.explanation}</p><p className="mt-2 text-sm font-bold text-tcds-ink">Next: {message.nextStep}</p>{message.supportReference&&<p className="mt-2 text-xs text-tcds-muted">Reference: {message.supportReference}</p>}<button onClick={onDetails} className="tcds-focus mt-3 min-h-11 rounded-xl border border-tcds-line bg-white px-3 font-black text-tcds-ink">View details</button></div></div>
 </div>;
}
