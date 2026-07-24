import { AlertOctagon, AlertTriangle, Boxes, CheckCircle2, ChevronDown, Loader2, MapPinned, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ScreenCard } from '../../components/ScreenCard';
import { LocationRecommendationCard } from './components/LocationRecommendationCard';
import { OfflineRecoveryBanner } from './components/OfflineRecoveryBanner';
import { OverrideReviewCard } from './components/OverrideReviewCard';
import { ScanConfirmationCard } from './components/ScanConfirmationCard';
import { StorageReadinessStrip } from './components/StorageReadinessStrip';
import { completePutAway, completionCheck, createOrResumePutAway, refreshRecommendations, releaseClaim, renewClaim, reportException, requestReview, requestTakeover, scanItem, scanLocation, selectRecommendation, StorageApiError, submitFeedback } from './services/storageApi';
import { listOfflineOperations, queueOfflineOperation } from './services/storageOfflineQueue';
import type { LocationRecommendation, OfflinePutAwayOperation, OverrideLevel, PutAwayCompletion, PutAwaySession } from './types/storageTypes';

const EXCEPTIONS = ['BIN_FULL','BIN_DAMAGED','BIN_INACCESSIBLE','HAZARD_CONFLICT','OVERSIZED_ITEM','RESERVED_LOCATION','DUPLICATE_PLACEMENT','CONCURRENT_ASSIGNMENT','NO_SUITABLE_LOCATION','MULTI_PIECE_ITEM','LOCATION_MAINTENANCE','SECURITY_ZONE_MISMATCH','SCANNER_FAILURE_AFTER_PLACEMENT'] as const;

export function StorageAssignmentScreen() {
  const navigate = useNavigate(); const location = useLocation(); const [params] = useSearchParams();
  const workflowToken = params.get('workflow') ?? (location.state as { workflowToken?: string } | null)?.workflowToken ?? '';
  const [session, setSession] = useState<PutAwaySession | null>(null); const [selected, setSelected] = useState<LocationRecommendation | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const [showAlternatives, setShowAlternatives] = useState(false); const [exceptionType, setExceptionType] = useState<(typeof EXCEPTIONS)[number]>('BIN_FULL');
  const [exceptionNotes, setExceptionNotes] = useState(''); const [completion, setCompletion] = useState<PutAwayCompletion | null>(null);
  const [online, setOnline] = useState(navigator.onLine); const [queueCount, setQueueCount] = useState(0); const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => { listOfflineOperations(session?.putAwaySessionId).then((ops) => setQueueCount(ops.length)).catch(() => setQueueCount(0)); }, [session?.putAwaySessionId]);
  useEffect(() => {
    if (!workflowToken) { setLoading(false); setError('A valid Inspection & Verification handoff is required before storage assignment can begin.'); return; }
    createOrResumePutAway(workflowToken).then((result) => { if (!mounted.current) return; setSession(result); setSelected(result.recommendation); setError(undefined); }).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load storage assignment.')).finally(() => setLoading(false));
  }, [workflowToken]);
  useEffect(() => {
    if (!session || session.status === 'COMPLETED') return;
    const interval = window.setInterval(() => { if (navigator.onLine) renewClaim(session.putAwaySessionId, session.rowVersion).then(setSession).catch(() => undefined); }, 60_000);
    return () => window.clearInterval(interval);
  }, [session?.putAwaySessionId, session?.rowVersion, session?.status]);
  useEffect(() => () => { if (session && session.status !== 'COMPLETED' && navigator.onLine) releaseClaim(session.putAwaySessionId, session.rowVersion).catch(() => undefined); }, [session?.putAwaySessionId]);

  const canComplete = useMemo(() => Boolean(session && selected && online && queueCount === 0 && session.gate?.gatePassed && session.readiness.overall === 'READY' && !busy), [busy, online, queueCount, selected, session]);

  async function act(action: () => Promise<PutAwaySession>) { if (!session) return; setBusy(true); setError(undefined); try { const next = await action(); setSession(next); setSelected(next.recommendation); } catch (caught) { const err = caught as StorageApiError; setError(`${err.message}${err.supportReference ? ` Reference: ${err.supportReference}` : ''}`); } finally { setBusy(false); } }

  async function safeScan(type: 'ITEM_SCAN'|'LOCATION_SCAN', barcode: string) {
    if (!session) return; const idempotencyKey = crypto.randomUUID();
    if (!online) {
      const operation: OfflinePutAwayOperation = { operationId: crypto.randomUUID(), sessionId: session.putAwaySessionId, type, payload: { barcode, rowVersion: session.rowVersion }, idempotencyKey, clientOccurredAt: new Date().toISOString(), status: 'QUEUED', attemptCount: 0 };
      await queueOfflineOperation(operation); setQueueCount((value) => value + 1); setError('Scan preserved locally. Reconnect to validate it before completion.'); return;
    }
    await act(() => type === 'ITEM_SCAN' ? scanItem(session.putAwaySessionId, barcode, session.rowVersion, idempotencyKey) : scanLocation(session.putAwaySessionId, barcode, session.rowVersion, idempotencyKey));
  }

  if (loading) return <><AppHeader title="Storage Assignment" subtitle="Preparing verified item for put-away"/><div className="mx-auto max-w-md p-4"><ScreenCard><div className="flex items-center gap-3"><Loader2 className="animate-spin text-tcds-gold"/><p className="font-black">Loading location intelligence…</p></div></ScreenCard></div></>;
  if (!session) return <><AppHeader title="Storage Assignment" subtitle="Verified item handoff required"/><div className="mx-auto max-w-md p-4"><ScreenCard><div className="text-center"><AlertOctagon className="mx-auto text-tcds-red" size={44}/><h2 className="mt-3 font-display text-section font-black">Put-away cannot start</h2><p className="mt-2 text-sm font-semibold text-tcds-muted">{error}</p><button className="mt-4 font-black text-tcds-goldDeep" onClick={() => navigate('/dashboard')}>Return to Dashboard</button></div></ScreenCard></div></>;

  return <><AppHeader title="Storage Assignment" subtitle="AI-guided put-away with scan-to-confirm"/><main className="mx-auto max-w-md space-y-4 p-4">
    <OfflineRecoveryBanner online={online} queueCount={queueCount}/>
    {error && <div role="alert" className="rounded-enterprise border border-tcds-red/25 bg-red-50 p-4 text-sm font-bold text-tcds-red">{error}</div>}

    <ScreenCard><div className="flex items-start gap-3"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-tcds-black text-tcds-gold"><Boxes size={25}/></span><div className="min-w-0 flex-1"><p className="text-caption font-black uppercase tracking-[0.22em] text-tcds-goldDeep">Verified Digital Twin</p><h2 className="truncate font-display text-card font-black">{session.item.internalBarcode}</h2><p className="mt-1 text-sm font-black">{session.item.title}</p><p className="text-xs font-semibold text-tcds-muted">{session.item.brand ?? '—'} {session.item.model ?? ''} · {session.item.condition} · {session.item.actualWeightOz ?? '—'} oz</p></div><span className="rounded-xl bg-green-50 px-2 py-1 text-[10px] font-black text-tcds-green">VERIFIED</span></div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-bold"><div className="rounded-xl bg-tcds-surface p-2"><p className="text-tcds-muted">Photos</p><p className="text-tcds-green">{session.item.photoStatus}</p></div><div className="rounded-xl bg-tcds-surface p-2"><p className="text-tcds-muted">Battery</p><p>{session.item.containsBattery ? 'Yes' : 'No'}</p></div><div className="rounded-xl bg-tcds-surface p-2"><p className="text-tcds-muted">Holds</p><p className={session.item.activeHoldCount ? 'text-tcds-red' : 'text-tcds-green'}>{session.item.activeHoldCount}</p></div></div>
    </ScreenCard>

    <ScreenCard><div className="mb-3 flex items-center justify-between"><div><p className="text-caption font-black uppercase tracking-[0.22em] text-tcds-goldDeep">Operational Readiness</p><h2 className="font-display text-card font-black">{session.facility.facilityCode} · {session.station.stationCode}</h2></div><span className={`rounded-xl px-3 py-2 text-xs font-black ${session.readiness.overall === 'READY' ? 'bg-green-50 text-tcds-green' : 'bg-red-50 text-tcds-red'}`}>{session.readiness.overall}</span></div><StorageReadinessStrip readiness={session.readiness}/></ScreenCard>

    {session.recommendation ? <ScreenCard><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-caption font-black uppercase tracking-[0.22em] text-tcds-goldDeep">AI Location Recommendation</p><h2 className="font-display text-section font-black">Best Available Location</h2></div><button disabled={busy || !online} onClick={() => act(() => refreshRecommendations(session.putAwaySessionId, session.rowVersion, 'OPERATOR_REFRESH'))} className="tcds-focus rounded-2xl border border-tcds-line p-3 disabled:opacity-40"><RefreshCw size={18} className={busy ? 'animate-spin' : ''}/></button></div><LocationRecommendationCard recommendation={session.recommendation} selected={selected?.recommendationId === session.recommendation.recommendationId} onSelect={() => act(() => selectRecommendation(session.putAwaySessionId, session.recommendation!.recommendationId, session.rowVersion))} disabled={busy || !online}/>
      <button onClick={() => setShowAlternatives((value) => !value)} className="mt-3 flex w-full items-center justify-between rounded-2xl bg-tcds-surface p-3 text-sm font-black"><span>Alternative locations ({session.alternatives.length})</span><ChevronDown className={showAlternatives ? 'rotate-180' : ''} size={18}/></button>{showAlternatives && <div className="mt-3 space-y-3">{session.alternatives.map((r) => <LocationRecommendationCard key={r.recommendationId} recommendation={r} selected={selected?.recommendationId === r.recommendationId} onSelect={() => {
        const reason = selected && selected.recommendationId !== r.recommendationId ? window.prompt('Why are you rejecting the current recommendation?')?.trim() : undefined;
        act(() => selectRecommendation(session.putAwaySessionId, r.recommendationId, session.rowVersion, reason));
        submitFeedback(session.putAwaySessionId, { recommendedLocationId: session.recommendation?.locationId, selectedLocationId: r.locationId, rejectionReason: reason, modelVersion: r.modelVersion, featureSnapshotId: r.featureSnapshotId }).catch(() => undefined);
      }} disabled={busy || !online}/>)}</div>}</ScreenCard> : <ScreenCard><div className="text-center"><AlertTriangle className="mx-auto text-tcds-warning"/><p className="mt-2 font-black">No suitable location available</p><p className="text-xs font-semibold text-tcds-muted">Create an exception or request controlled review. Do not place the item manually.</p></div></ScreenCard>}

    {selected && <><ScanConfirmationCard title="Scan TCDS Item" instruction="Confirm the exact verified item before moving it." expected={session.item.internalBarcode} value={session.scannedItemBarcode ?? ''} onSubmit={(barcode) => safeScan('ITEM_SCAN', barcode)} disabled={busy}/><ScanConfirmationCard title="Scan Destination Bin" instruction="Place the item, then scan the physical destination label." expected={selected.locationCode} value={session.scannedLocationBarcode ?? ''} onSubmit={(barcode) => safeScan('LOCATION_SCAN', barcode)} disabled={busy || !session.scannedItemBarcode}/></>}

    <ScreenCard><p className="text-caption font-black uppercase tracking-[0.22em] text-tcds-goldDeep">Operational Exception</p><div className="mt-3 grid grid-cols-2 gap-2"><select value={exceptionType} onChange={(e) => setExceptionType(e.target.value as typeof exceptionType)} className="min-h-12 rounded-2xl border border-tcds-line bg-white px-3 text-sm font-bold">{EXCEPTIONS.map((value) => <option key={value}>{value}</option>)}</select><button disabled={busy || !online || !exceptionNotes.trim()} onClick={() => act(() => reportException(session.putAwaySessionId, exceptionType, exceptionNotes, session.rowVersion))} className="rounded-2xl bg-tcds-black px-3 font-black text-white disabled:bg-neutral-300">Report</button></div><textarea value={exceptionNotes} onChange={(e) => setExceptionNotes(e.target.value)} placeholder="Required evidence and notes" className="mt-2 min-h-20 w-full rounded-2xl border border-tcds-line p-3 text-base"/></ScreenCard>

    <OverrideReviewCard disabled={busy || !online} onRequest={(level: OverrideLevel, reason) => act(() => requestReview(session.putAwaySessionId, reason, level, session.rowVersion))}/>

    {session.claimOwnerDeviceId && session.status === 'TAKEOVER_PENDING' && <ScreenCard><p className="font-black text-tcds-warning">Session active on another device</p><p className="mt-1 text-xs font-semibold text-tcds-muted">Owner: {session.claimOwnerDisplayName ?? session.claimOwnerDeviceId}</p><button onClick={() => act(() => requestTakeover(session.putAwaySessionId, 'Operator requests recovery of abandoned put-away session'))} className="mt-3 rounded-2xl bg-tcds-black px-4 py-3 font-black text-white">Request Takeover</button></ScreenCard>}

    <ScreenCard><div className="flex items-center justify-between"><div><p className="text-caption font-black uppercase tracking-[0.22em] text-tcds-goldDeep">Authoritative Completion Gate</p><h2 className="font-display text-card font-black">Inventory commit readiness</h2></div>{session.gate?.gatePassed ? <CheckCircle2 className="text-tcds-green"/> : <ShieldCheck className="text-tcds-warning"/>}</div><div className="mt-3 space-y-2">{session.gate?.checks.map((check) => <div key={check.code} className="flex items-start gap-2 text-xs font-semibold"><span className={check.passed ? 'text-tcds-green' : check.blocking ? 'text-tcds-red' : 'text-tcds-warning'}>{check.passed ? 'PASS' : 'BLOCK'}</span><span>{check.message}</span></div>) ?? <p className="text-xs text-tcds-muted">Run the server completion check after both scans.</p>}</div><button disabled={busy || !online || !session.scannedItemBarcode || !session.scannedLocationBarcode} onClick={() => act(() => completionCheck(session.putAwaySessionId, session.rowVersion))} className="mt-3 w-full rounded-2xl border border-tcds-line py-3 font-black disabled:opacity-40">Run Completion Check</button></ScreenCard>

    {completion ? <ScreenCard><div className="text-center"><CheckCircle2 className="mx-auto text-tcds-green" size={46}/><h2 className="mt-3 font-display text-section font-black">Put-away complete</h2><p className="text-sm font-semibold text-tcds-muted">{completion.locationCode} · Item is AVAILABLE</p><PrimaryButton onClick={() => navigate(completion.nextWorkflow.route, { state: { workflowToken: completion.nextWorkflow.workflowToken } })}>Continue</PrimaryButton></div></ScreenCard> : <PrimaryButton disabled={!canComplete} onClick={async () => { setBusy(true); setError(undefined); try { const done = await completePutAway(session.putAwaySessionId, session.rowVersion); setCompletion(done); } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); } }}>{busy ? 'Committing Inventory…' : 'Complete Put-Away'}</PrimaryButton>}
    {!online && <div className="flex items-center justify-center gap-2 text-xs font-bold text-tcds-red"><WifiOff size={14}/>Reconnect to complete storage assignment.</div>}
  </main></>;
}
