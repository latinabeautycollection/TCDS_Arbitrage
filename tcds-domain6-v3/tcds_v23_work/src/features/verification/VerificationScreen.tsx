import { AlertOctagon, BrainCircuit, RefreshCw, ShieldCheck, UserCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ScreenCard } from '../../components/ScreenCard';
import { AdaptiveVerificationCard } from './components/AdaptiveVerificationCard';
import { CompletionGateCard } from './components/CompletionGateCard';
import * as api from './services/verificationApi';
import type { AdaptiveCard, ApiProblem, VerificationSession } from './types/verificationTypes';

const demoSession: VerificationSession = {
  context: { verificationId: 'demo-verification', itemId: 'demo-item', internalBarcode: 'TCDS-INV-2026-00000184-7', productTitle: 'Apple AirPods Pro 2nd Generation', category: 'Consumer Electronics', facilityCode: 'TCDS-VA-01', stationCode: 'VERIFY-01', photoSessionId: 'demo-photo', profileCode: 'GENERAL_ELECTRONICS', profileVersion: 1 },
  evidence: { accepted: 8, required: 8, pending: 0, rejected: 0, integrityVerified: true },
  cards: [
    { cardId: 'identity', type: 'IDENTITY', title: 'Identity', summary: 'UPC, model, and serial matched', state: 'PASS', confidence: 99.3, reasons: [], systemFacts: [{ label: 'Expected', value: 'Apple AirPods Pro 2nd Gen' }, { label: 'Received', value: 'Apple AirPods Pro 2nd Gen' }, { label: 'AI confidence', value: '99.3%' }, { label: 'Serial', value: 'Unique & verified' }], blocking: true, sequenceNo: 1, unlocked: true },
    { cardId: 'photos', type: 'PHOTOS', title: 'Photo Evidence', summary: '8 of 8 artifacts accepted and integrity verified', state: 'PASS', reasons: [], systemFacts: [{ label: 'Accepted', value: '8 / 8' }, { label: 'Hash integrity', value: 'Verified' }], blocking: true, sequenceNo: 2, unlocked: true },
    { cardId: 'accessories', type: 'ACCESSORIES', title: 'Accessories', summary: 'Charging cable requires operator confirmation', state: 'ACTION_REQUIRED', reasons: ['AI could not confirm the charging cable in accepted evidence.'], systemFacts: [{ label: 'Expected', value: 'Charging cable' }, { label: 'AI result', value: 'Not visible' }], operatorPrompt: 'Physically confirm the charging cable status.', options: [{ value: 'PRESENT', label: 'Present' }, { value: 'MISSING', label: 'Missing', destructive: true }, { value: 'NOT_REQUIRED', label: 'Not required' }], notesRequired: false, notes: '', blocking: true, sequenceNo: 3, unlocked: true },
    { cardId: 'condition', type: 'CONDITION', title: 'Condition', summary: 'AI suggests Excellent', state: 'ACTION_REQUIRED', reasons: [], systemFacts: [{ label: 'AI suggestion', value: 'Excellent' }, { label: 'Photo consistency', value: 'Passed' }], operatorPrompt: 'Confirm the physical condition.', options: [{ value: 'EXCELLENT', label: 'Excellent' }, { value: 'GOOD', label: 'Good' }, { value: 'FAIR', label: 'Fair' }, { value: 'DAMAGED', label: 'Damaged', destructive: true }], notesRequired: false, notes: '', blocking: true, sequenceNo: 4, unlocked: true },
    { cardId: 'power', type: 'POWER_TEST', title: 'Power Test', summary: 'Not required for this product profile', state: 'NOT_APPLICABLE', reasons: [], systemFacts: [], blocking: false, sequenceNo: 5, unlocked: true },
    { cardId: 'safety', type: 'SAFETY', title: 'Safety', summary: 'No hazard indicators detected', state: 'PASS', reasons: [], systemFacts: [{ label: 'Battery risk', value: 'None detected' }, { label: 'Contamination', value: 'None detected' }], blocking: true, sequenceNo: 6, unlocked: true },
    { cardId: 'fraud', type: 'FRAUD', title: 'Fraud & Substitution Risk', summary: 'No duplicate or substitution indicators', state: 'PASS', reasons: [], systemFacts: [{ label: 'Duplicate serial', value: 'No' }, { label: 'Product mismatch', value: 'No' }], blocking: true, sequenceNo: 7, unlocked: true },
    { cardId: 'risk', type: 'RISK', title: 'Operational Risk', summary: 'Low risk', state: 'PASS', reasons: [], systemFacts: [{ label: 'Risk score', value: '8 / 100' }], blocking: true, sequenceNo: 8, unlocked: true }
  ],
  completionGate: { gatePassed: false, outcome: 'DRAFT', identity: 'PASS', photos: 'PASS', accessories: 'ACTION_REQUIRED', condition: 'ACTION_REQUIRED', powerTest: 'NOT_APPLICABLE', safety: 'PASS', fraud: 'PASS', risk: 'PASS', blockingIssues: ['Accessory confirmation required', 'Condition confirmation required'], warnings: [], overrideApplied: false },
  operatorAttested: false, status: 'DRAFT', aiAvailable: true, online: true
};

export function VerificationScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const verificationId = params.get('session') ?? '';
  const demoMode = import.meta.env.VITE_SHELL_DEMO_MODE === 'true' || !verificationId;
  const [session, setSession] = useState<VerificationSession | null>(demoMode ? demoSession : null);
  const [error, setError] = useState<ApiProblem | null>(null);
  const [loading, setLoading] = useState(!demoMode);
  const [saving, setSaving] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [showReview, setShowReview] = useState(false);

  async function load() {
    if (demoMode) return;
    setLoading(true); setError(null);
    try { setSession(await api.getVerification(verificationId)); } catch (e) { setError(e as ApiProblem); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [verificationId]);

  const unresolved = useMemo(() => session?.cards.filter((card) => card.blocking && !['PASS', 'WARNING', 'NOT_APPLICABLE', 'OVERRIDDEN'].includes(card.state)).length ?? 0, [session]);

  async function updateCard(next: AdaptiveCard) {
    if (!session) return;
    const optimistic = { ...session, cards: session.cards.map((card) => card.cardId === next.cardId ? next : card) };
    setSession(optimistic);
    if (demoMode) return;
    setSaving(true);
    try { setSession(await api.saveCardDecision(session.context.verificationId, next)); } catch (e) { setError(e as ApiProblem); await load(); } finally { setSaving(false); }
  }

  async function attest() {
    if (!session) return;
    if (demoMode) { setSession({ ...session, operatorAttested: true }); return; }
    setSaving(true); try { setSession(await api.attestVerification(session.context.verificationId)); } catch (e) { setError(e as ApiProblem); } finally { setSaving(false); }
  }

  async function assessAndCheck() {
    if (!session) return;
    setSaving(true); setError(null);
    try {
      if (demoMode) {
        const cards = session.cards.map((card) => card.selectedValue || ['PASS', 'WARNING', 'NOT_APPLICABLE'].includes(card.state) ? card : card);
        const blockers = cards.filter((card) => card.blocking && !['PASS', 'WARNING', 'NOT_APPLICABLE'].includes(card.state));
        setSession({ ...session, cards, completionGate: { ...session.completionGate, gatePassed: blockers.length === 0 && session.operatorAttested, outcome: blockers.length === 0 && session.operatorAttested ? 'VERIFIED' : 'DRAFT', accessories: cards.find((c) => c.cardId === 'accessories')?.state ?? 'ACTION_REQUIRED', condition: cards.find((c) => c.cardId === 'condition')?.state ?? 'ACTION_REQUIRED', blockingIssues: blockers.map((c) => `${c.title} requires action`) } });
      } else {
        const assessed = await api.runAssessment(session.context.verificationId);
        const gate = await api.completionCheck(session.context.verificationId);
        setSession({ ...assessed, completionGate: gate });
      }
    } catch (e) { setError(e as ApiProblem); } finally { setSaving(false); }
  }

  async function complete() {
    if (!session?.completionGate.gatePassed) return;
    if (demoMode) { navigate('/storage', { state: { itemId: session.context.itemId, verificationId: session.context.verificationId } }); return; }
    setSaving(true); try { const completed = await api.completeVerification(session.context.verificationId); if (completed.nextWorkflow) navigate(completed.nextWorkflow.route, { state: { workflowToken: completed.nextWorkflow.workflowToken } }); } catch (e) { setError(e as ApiProblem); } finally { setSaving(false); }
  }

  async function sendReview() {
    if (!session || !reviewReason.trim()) return;
    setSaving(true); try { if (!demoMode) setSession(await api.requestReview(session.context.verificationId, reviewReason.trim())); setShowReview(false); setReviewReason(''); } catch (e) { setError(e as ApiProblem); } finally { setSaving(false); }
  }

  return <>
    <AppHeader title="Inspection & Verification" subtitle="Adaptive quality inspection and exception decisioning" />
    <main className="mx-auto max-w-md space-y-4 p-4">
      {loading && <ScreenCard><div className="space-y-3"><div className="skeleton h-8 rounded-xl"/><div className="skeleton h-24 rounded-2xl"/><div className="skeleton h-24 rounded-2xl"/></div></ScreenCard>}
      {error && <ScreenCard className="border-red-200 bg-red-50"><div className="flex gap-3"><AlertOctagon className="text-red-700"/><div><h2 className="font-black text-red-900">Verification unavailable</h2><p className="mt-1 text-sm font-semibold text-red-800">{error.message}</p>{error.requestId && <p className="mt-2 text-xs text-red-700">Reference: {error.requestId}</p>}</div></div>{error.retryable && <button onClick={() => void load()} className="tcds-focus enterprise-motion mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-300 bg-white font-black text-red-800"><RefreshCw size={17}/>Retry</button>}</ScreenCard>}
      {session && <>
        <ScreenCard>
          <div className="flex items-start justify-between gap-3"><div><p className="text-caption font-black uppercase tracking-[0.25em] text-tcds-gold">Digital Twin</p><h2 className="mt-1 font-display text-card font-black text-tcds-ink">{session.context.internalBarcode}</h2><p className="mt-1 text-sm font-semibold text-tcds-muted">{session.context.productTitle}</p></div><ShieldCheck className="text-tcds-gold" size={28}/></div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm"><div className="rounded-2xl bg-tcds-surface p-3"><p className="text-xs font-black uppercase text-tcds-muted">Facility</p><p className="font-black">{session.context.facilityCode}</p></div><div className="rounded-2xl bg-tcds-surface p-3"><p className="text-xs font-black uppercase text-tcds-muted">Station</p><p className="font-black">{session.context.stationCode}</p></div></div>
          <div className="mt-3 flex items-center justify-between rounded-2xl border border-tcds-line p-3"><div><p className="font-black">Photo evidence</p><p className="text-sm text-tcds-muted">{session.evidence.accepted} of {session.evidence.required} accepted</p></div><span className="font-black text-tcds-green">{session.evidence.integrityVerified ? 'Integrity verified' : 'Pending'}</span></div>
        </ScreenCard>
        {!session.aiAvailable && <ScreenCard className="border-amber-200 bg-amber-50"><div className="flex gap-3"><BrainCircuit className="text-amber-700"/><div><h2 className="font-black text-amber-900">AI assessment delayed</h2><p className="text-sm font-semibold text-amber-800">Inspection responses are saved. Storage remains blocked until assessment or an authorized continuity override.</p></div></div></ScreenCard>}
        <div className="space-y-3">{[...session.cards].sort((a,b) => a.sequenceNo-b.sequenceNo).map((card) => <AdaptiveVerificationCard key={card.cardId} card={card} onChange={(next) => void updateCard(next)} />)}</div>
        <ScreenCard>
          <label className="flex items-start gap-3"><input type="checkbox" checked={session.operatorAttested} onChange={() => void attest()} className="mt-1 h-5 w-5 accent-black"/><span className="text-sm font-semibold text-tcds-ink"><strong className="block font-black">Employee attestation</strong>I physically inspected this item and confirm the identifiers, condition, components, and submitted information are accurate.</span></label>
        </ScreenCard>
        <CompletionGateCard gate={session.completionGate} />
        <ScreenCard>
          <div className="mb-3 flex items-center justify-between"><div><p className="font-black text-tcds-ink">Actions</p><p className="text-sm text-tcds-muted">{unresolved} blocking card{unresolved === 1 ? '' : 's'} remain</p></div><UserCheck className="text-tcds-gold"/></div>
          <PrimaryButton loading={saving} onClick={() => void assessAndCheck()} disabled={!session.operatorAttested}>Validate & Run Completion Gate</PrimaryButton>
          <button type="button" onClick={() => setShowReview(true)} className="tcds-focus enterprise-motion mt-3 min-h-12 w-full rounded-enterprise border border-tcds-line bg-white px-4 py-3 font-black text-tcds-ink">Request Manager Review</button>
          <PrimaryButton className="mt-3" loading={saving} disabled={!session.completionGate.gatePassed} onClick={() => void complete()}>Continue to Storage</PrimaryButton>
        </ScreenCard>
        {showReview && <ScreenCard className="border-tcds-gold/40"><h2 className="font-display text-card font-black">Manager Review Required</h2><p className="mt-1 text-sm text-tcds-muted">Describe the observed exception. The original AI and employee findings remain immutable.</p><textarea value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} className="tcds-focus mt-3 min-h-28 w-full rounded-2xl border border-tcds-line p-3 text-base" placeholder="Required factual reason"/><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => setShowReview(false)} className="min-h-12 rounded-2xl border border-tcds-line font-black">Cancel</button><button onClick={() => void sendReview()} disabled={!reviewReason.trim() || saving} className="min-h-12 rounded-2xl bg-tcds-black font-black text-white disabled:opacity-50">Submit Review</button></div></ScreenCard>}
      </>}
    </main>
  </>;
}
