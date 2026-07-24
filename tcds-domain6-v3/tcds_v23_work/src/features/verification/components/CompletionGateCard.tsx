import type { CompletionGate } from '../types/verificationTypes';
import { GateBadge } from './GateBadge';

export function CompletionGateCard({ gate }: { gate: CompletionGate }) {
  const rows: Array<[string, keyof CompletionGate]> = [
    ['Identity', 'identity'], ['Photos', 'photos'], ['Accessories', 'accessories'], ['Condition', 'condition'],
    ['Power Test', 'powerTest'], ['Safety', 'safety'], ['Fraud', 'fraud'], ['Risk', 'risk']
  ];
  return <section className="rounded-enterprise border border-tcds-line bg-tcds-black p-5 text-white shadow-card">
    <p className="text-caption font-black uppercase tracking-[0.25em] text-tcds-gold">Authoritative Completion Gate</p>
    <div className="mt-4 space-y-2">{rows.map(([label, key]) => <div key={label} className="flex items-center justify-between rounded-2xl bg-white/8 px-3 py-2"><span className="font-bold">{label}</span><GateBadge state={gate[key] as CompletionGate['identity']} /></div>)}</div>
    {gate.blockingIssues.length > 0 && <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-950/40 p-3"><p className="font-black text-red-200">Blocking issues</p><ul className="mt-2 space-y-1 text-sm text-red-100">{gate.blockingIssues.map((issue) => <li key={issue}>• {issue}</li>)}</ul></div>}
    {gate.overrideApplied && <p className="mt-3 rounded-xl bg-tcds-gold/15 p-3 text-sm font-black text-tcds-gold">Authorized override applied. Original findings remain preserved.</p>}
  </section>;
}
