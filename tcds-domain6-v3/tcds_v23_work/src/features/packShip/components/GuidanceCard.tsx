import { ArrowRight, CircleHelp } from 'lucide-react';
export function GuidanceCard({ what, why, next }: { what: string; why: string; next: string }) {
  return <div className="mt-3 rounded-2xl border border-tcds-gold/25 bg-tcds-gold/10 p-3"><div className="flex items-center gap-2"><CircleHelp size={17} className="text-tcds-goldDeep"/><p className="text-xs font-black uppercase tracking-[.14em] text-tcds-goldDeep">Step guidance</p></div><p className="mt-2 text-sm font-black text-tcds-ink">{what}</p><p className="mt-1 text-xs text-tcds-muted">Why: {why}</p><p className="mt-2 flex items-center gap-1 text-xs font-bold text-tcds-ink"><ArrowRight size={14}/> Next: {next}</p></div>;
}
