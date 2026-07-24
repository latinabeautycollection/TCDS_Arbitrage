import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export function DigitalTwinHealth({ score, compact = false }: { score: number; compact?: boolean }) {
  const healthy = score >= 90;
  const warning = score >= 70 && score < 90;
  const label = healthy ? 'Healthy' : warning ? 'Review' : 'At Risk';
  return (
    <div className={`rounded-2xl border border-tcds-line bg-white ${compact ? 'p-2.5' : 'p-4'} shadow-surface`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {healthy ? <CheckCircle2 size={16} className="text-tcds-green" /> : <AlertTriangle size={16} className="text-amber-600" />}
          <span className="text-xs font-black text-tcds-ink">Digital Twin Health</span>
        </div>
        <span className="font-display text-lg font-black text-tcds-ink">{score}%</span>
      </div>
      {!compact && <div className="mt-2 h-2 overflow-hidden rounded-full bg-tcds-surface"><div className="h-full rounded-full bg-tcds-gold" style={{ width: `${Math.max(0, Math.min(score, 100))}%` }} /></div>}
      <p className="mt-1 text-[11px] font-bold text-tcds-muted">{label}</p>
    </div>
  );
}
