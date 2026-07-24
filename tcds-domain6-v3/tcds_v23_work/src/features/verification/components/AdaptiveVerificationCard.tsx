import { ChevronDown, ChevronUp, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import type { AdaptiveCard } from '../types/verificationTypes';
import { GateBadge } from './GateBadge';

export function AdaptiveVerificationCard({ card, onChange }: { card: AdaptiveCard; onChange: (next: AdaptiveCard) => void }) {
  const [expanded, setExpanded] = useState(card.state !== 'PASS' && card.state !== 'NOT_APPLICABLE');
  const disabled = !card.unlocked || card.state === 'PROCESSING';
  return (
    <section className={`rounded-enterprise border bg-white p-4 shadow-card ${card.blocking && card.state === 'BLOCKED' ? 'border-red-300' : 'border-tcds-line'}`}>
      <button type="button" onClick={() => setExpanded((value) => !value)} className="tcds-focus flex w-full items-start justify-between gap-3 text-left" aria-expanded={expanded}>
        <div>
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-display text-card font-black text-tcds-ink">{card.title}</h3><GateBadge state={card.state} /></div>
          <p className="mt-1 text-sm font-semibold text-tcds-muted">{card.summary}</p>
        </div>
        {!card.unlocked ? <LockKeyhole size={18} className="mt-1 text-tcds-muted" /> : expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {expanded && (
        <div className="mt-4 space-y-4 border-t border-tcds-line pt-4">
          {card.systemFacts.length > 0 && <div className="grid grid-cols-2 gap-2">{card.systemFacts.map((fact) => <div key={`${fact.label}-${fact.value}`} className="rounded-2xl bg-tcds-surface p-3"><p className="text-[11px] font-black uppercase tracking-wide text-tcds-muted">{fact.label}</p><p className="mt-1 break-words text-sm font-black text-tcds-ink">{fact.value}</p></div>)}</div>}
          {card.reasons.length > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-black uppercase tracking-wide text-amber-800">System findings</p><ul className="mt-2 space-y-1 text-sm font-semibold text-amber-900">{card.reasons.map((reason) => <li key={reason}>• {reason}</li>)}</ul></div>}
          {card.operatorPrompt && <p className="text-sm font-black text-tcds-ink">{card.operatorPrompt}</p>}
          {card.options && <div className="grid gap-2">{card.options.map((option) => <button key={option.value} type="button" disabled={disabled} onClick={() => onChange({ ...card, selectedValue: option.value, state: 'PASS' })} className={`tcds-focus enterprise-motion min-h-12 rounded-2xl border px-4 py-3 text-left font-black ${card.selectedValue === option.value ? 'border-tcds-gold bg-tcds-gold/10 text-tcds-goldDeep' : option.destructive ? 'border-red-200 bg-red-50 text-red-800' : 'border-tcds-line bg-white text-tcds-ink'}`}>{option.label}</button>)}</div>}
          {(card.notesRequired || card.notes !== undefined) && <div><label className="text-sm font-black text-tcds-ink" htmlFor={`notes-${card.cardId}`}>Notes{card.notesRequired ? ' (required)' : ''}</label><textarea id={`notes-${card.cardId}`} disabled={disabled} value={card.notes ?? ''} onChange={(event) => onChange({ ...card, notes: event.target.value })} className="tcds-focus mt-2 min-h-24 w-full rounded-2xl border border-tcds-line bg-white p-3 text-base text-tcds-ink" placeholder="Record only facts observed during inspection." /></div>}
        </div>
      )}
    </section>
  );
}
