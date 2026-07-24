import { AlertTriangle, CheckCircle2, Clock3, MinusCircle, ShieldAlert, XCircle } from 'lucide-react';
import type { GateState } from '../types/verificationTypes';

const styles: Record<GateState, string> = {
  PASS: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  WARNING: 'border-amber-200 bg-amber-50 text-amber-800',
  ACTION_REQUIRED: 'border-tcds-gold/30 bg-tcds-gold/10 text-tcds-goldDeep',
  BLOCKED: 'border-red-200 bg-red-50 text-red-800',
  PROCESSING: 'border-blue-200 bg-blue-50 text-blue-800',
  NOT_APPLICABLE: 'border-tcds-line bg-tcds-surface text-tcds-muted',
  OVERRIDDEN: 'border-violet-200 bg-violet-50 text-violet-800'
};

export function GateBadge({ state }: { state: GateState }) {
  const Icon = state === 'PASS' ? CheckCircle2 : state === 'WARNING' ? AlertTriangle : state === 'ACTION_REQUIRED' ? ShieldAlert : state === 'BLOCKED' ? XCircle : state === 'PROCESSING' ? Clock3 : state === 'OVERRIDDEN' ? ShieldAlert : MinusCircle;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${styles[state]}`}><Icon size={13} />{state.replace(/_/g, ' ')}</span>;
}
