import { AlertTriangle, CheckCircle2, Route, Sparkles } from 'lucide-react';
import { CapacityLedgerCard } from './CapacityLedgerCard';
import type { LocationRecommendation } from '../types/storageTypes';
export function LocationRecommendationCard({ recommendation, selected, onSelect, disabled }: { recommendation: LocationRecommendation; selected: boolean; onSelect: () => void; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onSelect} className={`tcds-focus w-full rounded-enterprise border p-4 text-left shadow-soft ${selected ? 'border-tcds-gold bg-amber-50/40' : 'border-tcds-line bg-white'} disabled:opacity-60`}>
    <div className="flex items-start justify-between gap-3"><div><p className="text-caption font-black uppercase tracking-[0.22em] text-tcds-goldDeep">{recommendation.suitability}</p><h3 className="font-display text-section font-black text-tcds-ink">{recommendation.locationCode}</h3><p className="text-xs font-semibold text-tcds-muted">{recommendation.locationName}</p></div><div className="rounded-2xl bg-tcds-black px-3 py-2 text-center text-white"><Sparkles size={14} className="mx-auto text-tcds-gold"/><p className="font-display text-lg font-black">{recommendation.confidence.toFixed(1)}%</p></div></div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold"><span className="rounded-xl bg-tcds-surface p-2"><Route size={14} className="mb-1 text-tcds-gold"/>{recommendation.walkingDistanceFeet ?? '—'} ft</span><span className="rounded-xl bg-tcds-surface p-2">Pick score {recommendation.pickOptimizationScore?.toFixed(0) ?? '—'}</span></div>
    <div className="mt-3"><CapacityLedgerCard capacity={recommendation.capacity}/></div>
    <ul className="mt-3 space-y-1.5">{recommendation.reasons.slice(0,4).map((r) => <li key={r} className="flex gap-2 text-xs font-semibold"><CheckCircle2 size={15} className="shrink-0 text-tcds-green"/>{r}</li>)}{recommendation.warnings.map((w) => <li key={w} className="flex gap-2 text-xs font-semibold text-tcds-warning"><AlertTriangle size={15} className="shrink-0"/>{w}</li>)}</ul>
    {recommendation.modelVersion && <p className="mt-3 text-[9px] font-bold text-tcds-muted">Recommendation model {recommendation.modelVersion}</p>}
  </button>;
}
