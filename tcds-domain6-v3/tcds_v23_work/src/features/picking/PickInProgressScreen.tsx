import { AlertTriangle, CheckCircle2, Loader2, ScanLine, ShieldAlert, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ScreenCard } from '../../components/ScreenCard';
import { CurrentPickCard } from './components/CurrentPickCard';
import { GuidedPickSteps } from './components/GuidedPickSteps';
import { PickReadinessStrip } from './components/PickReadinessStrip';
import { PickTaskHeader } from './components/PickTaskHeader';
import { pickingApi } from './services/pickingApi';
import type { ExceptionType, PickTask } from './types/pickingTypes';

const stepPrompt: Record<PickTask['activeStep'], string> = {
  TRAVEL: 'Travel to the instructed source location. Do not remove inventory until online validation is available.',
  SCAN_LOCATION: 'Scan the exact source-location barcode.',
  SCAN_ITEM: 'Scan the permanent TCDS warehouse identity label on the exact reserved unit.',
  CONFIRM_CONDITION: 'Confirm the visible condition has not changed since verification.',
  SCAN_DESTINATION: 'Place the item into the assigned tote or packing stage, then scan that destination.',
  COMPLETE: 'Run the authoritative completion gate and hand the item to packing custody.',
};

export function PickInProgressScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const taskId = params.get('task');
  const [task, setTask] = useState<PickTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState('');
  const [exceptionNotes, setExceptionNotes] = useState('');
  const [showException, setShowException] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) { setError('A valid authorized pick-task handoff is required.'); setLoading(false); return; }
    try { setLoading(true); setTask(await pickingApi.getTask(taskId)); setError(null); }
    catch (e) { setError(messageFor(e)); }
    finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!task) return;
    const id = window.setInterval(() => { if (navigator.onLine) void pickingApi.renewClaim(task).then(setTask).catch(() => undefined); }, 45000);
    return () => window.clearInterval(id);
  }, [task]);

  const online = navigator.onLine;
  const authoritativeBlocked = !online || task?.readiness.overall === 'BLOCKED' || task?.readiness.database !== 'READY' || task?.readiness.api !== 'READY';
  const scanLabel = useMemo(() => task?.activeStep === 'SCAN_LOCATION' ? 'Scan Source Location' : task?.activeStep === 'SCAN_ITEM' ? 'Scan TCDS Item' : task?.activeStep === 'SCAN_DESTINATION' ? 'Scan Tote / Pack Stage' : 'Scan unavailable', [task]);

  async function submitScan() {
    if (!task || !scanValue.trim() || authoritativeBlocked) return;
    setBusy(true); setError(null);
    try {
      const result = task.activeStep === 'SCAN_LOCATION' ? await pickingApi.scanLocation(task, scanValue.trim()) : task.activeStep === 'SCAN_ITEM' ? await pickingApi.scanItem(task, scanValue.trim()) : await pickingApi.scanDestination(task, scanValue.trim());
      setTask(result.task); setScanValue('');
      if (!result.accepted) setError(result.message);
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }

  async function condition(result: 'UNCHANGED' | 'DAMAGE_FOUND' | 'PACKAGING_ISSUE' | 'IDENTITY_CONCERN') {
    if (!task || authoritativeBlocked) return;
    setBusy(true); setError(null);
    try { setTask(await pickingApi.confirmCondition(task, result)); if (result !== 'UNCHANGED') setShowException(true); }
    catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }

  async function exception(type: ExceptionType) {
    if (!task || authoritativeBlocked) return;
    setBusy(true); setError(null);
    try { setTask(await pickingApi.createException(task, type, exceptionNotes)); setShowException(false); setExceptionNotes(''); }
    catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }

  async function complete() {
    if (!task || authoritativeBlocked) return;
    setBusy(true); setError(null);
    try {
      const checked = await pickingApi.completionCheck(task); setTask(checked);
      if (!checked.completionGatePassed) { setError(checked.blockingReasons.join(' · ') || 'Completion gate did not pass.'); return; }
      const result = await pickingApi.complete(checked);
      if (result.nextTaskId) navigate(`/pick?task=${encodeURIComponent(result.nextTaskId)}`, { replace: true }); else navigate('/pack-ship', { state: { packingTaskId: result.packingTaskId } });
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }

  return <><AppHeader title="Pick in Progress" subtitle="Exact-item fulfillment and packing custody handoff" />
    <main className="mx-auto max-w-md space-y-4 p-4 pb-28">
      {loading && <ScreenCard><div className="grid min-h-56 place-items-center"><Loader2 className="animate-spin text-tcds-gold" size={34}/><p className="font-black text-tcds-muted">Loading authorized pick task…</p></div></ScreenCard>}
      {!loading && error && !task && <ScreenCard><div className="text-center"><ShieldAlert className="mx-auto text-tcds-red" size={38}/><h2 className="mt-3 font-display text-card font-black">Pick task unavailable</h2><p className="mt-2 text-sm text-tcds-muted">{error}</p><PrimaryButton className="mt-4" onClick={() => void load()}>Retry Secure Load</PrimaryButton></div></ScreenCard>}
      {task && <>
        <PickTaskHeader task={task}/><PickReadinessStrip readiness={task.readiness}/>
        {!online && <div className="rounded-enterprise border border-tcds-red/25 bg-red-50 p-4"><div className="flex gap-3"><WifiOff className="shrink-0 text-tcds-red"/><div><p className="font-black text-tcds-red">Offline — pick completion blocked</p><p className="mt-1 text-sm text-tcds-muted">Task instructions may be stale. Reconnect before removing inventory.</p></div></div></div>}
        {error && <div role="alert" className="rounded-enterprise border border-tcds-red/25 bg-red-50 p-4 text-sm font-bold text-tcds-red">{error}</div>}
        <CurrentPickCard item={task.current} next={task.next}/>
        <ScreenCard><h3 className="font-display text-section font-black text-tcds-ink">Guided Pick Sequence</h3><p className="mt-1 text-sm text-tcds-muted">{stepPrompt[task.activeStep]}</p><div className="mt-4"><GuidedPickSteps active={task.activeStep}/></div></ScreenCard>
        {(['SCAN_LOCATION','SCAN_ITEM','SCAN_DESTINATION'] as const).includes(task.activeStep as never) && <ScreenCard><label className="text-sm font-black text-tcds-ink" htmlFor="pick-scan">{scanLabel}</label><div className="mt-3 flex gap-2"><input id="pick-scan" value={scanValue} onChange={(e) => setScanValue(e.target.value)} autoCapitalize="characters" autoCorrect="off" inputMode="text" className="tcds-focus min-h-14 min-w-0 flex-1 rounded-2xl border border-tcds-line bg-white px-4 text-base font-black" placeholder="Scan or authorized exact entry"/><button aria-label={scanLabel} onClick={() => void submitScan()} disabled={busy || !scanValue.trim() || authoritativeBlocked} className="tcds-focus enterprise-motion grid min-h-14 w-14 place-items-center rounded-2xl bg-tcds-black text-white disabled:bg-neutral-300"><ScanLine/></button></div><p className="mt-2 text-xs text-tcds-muted">Manual entry is only accepted when the backend grants a scanner-failure exception and, for high-value items, records second-person confirmation.</p></ScreenCard>}
        {task.activeStep === 'CONFIRM_CONDITION' && <ScreenCard><h3 className="font-display text-section font-black">Visible condition unchanged?</h3><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => void condition('UNCHANGED')} disabled={busy || authoritativeBlocked} className="tcds-focus enterprise-motion min-h-14 rounded-2xl bg-tcds-black px-3 font-black text-white">Confirm</button><button onClick={() => void condition('DAMAGE_FOUND')} disabled={busy || authoritativeBlocked} className="tcds-focus enterprise-motion min-h-14 rounded-2xl border border-tcds-red/30 bg-red-50 px-3 font-black text-tcds-red">Damage Found</button><button onClick={() => void condition('PACKAGING_ISSUE')} disabled={busy || authoritativeBlocked} className="tcds-focus enterprise-motion min-h-14 rounded-2xl border border-tcds-line bg-white px-3 font-black">Packaging Issue</button><button onClick={() => void condition('IDENTITY_CONCERN')} disabled={busy || authoritativeBlocked} className="tcds-focus enterprise-motion min-h-14 rounded-2xl border border-tcds-line bg-white px-3 font-black">Identity Concern</button></div></ScreenCard>}
        <ScreenCard><div className="flex items-center justify-between gap-3"><div><h3 className="font-display text-section font-black">Operational Exception</h3><p className="text-sm text-tcds-muted">Do not silently correct inventory or bypass a mismatch.</p></div><button onClick={() => setShowException((v) => !v)} className="tcds-focus enterprise-motion rounded-xl border border-tcds-line bg-white px-3 py-2 text-sm font-black"><AlertTriangle size={16} className="mr-1 inline"/>Report</button></div>{showException && <div className="mt-4 space-y-3"><textarea value={exceptionNotes} onChange={(e) => setExceptionNotes(e.target.value)} className="tcds-focus min-h-24 w-full rounded-2xl border border-tcds-line p-3 text-base" placeholder="Describe the observed issue and containment action."/><div className="grid grid-cols-2 gap-2"><button onClick={() => void exception('ITEM_NOT_FOUND')} className="min-h-12 rounded-xl bg-tcds-surface px-2 text-sm font-black">Item Not Found</button><button onClick={() => void exception('WRONG_LOCATION')} className="min-h-12 rounded-xl bg-tcds-surface px-2 text-sm font-black">Wrong Location</button><button onClick={() => void exception('SCANNER_FAILURE')} className="min-h-12 rounded-xl bg-tcds-surface px-2 text-sm font-black">Scanner Failure</button><button onClick={() => void exception('UNKNOWN')} className="min-h-12 rounded-xl bg-tcds-surface px-2 text-sm font-black">Unknown Issue</button></div></div>}</ScreenCard>
        {task.activeStep === 'COMPLETE' && <ScreenCard><div className="mb-4 flex items-start gap-3 rounded-2xl bg-tcds-gold/10 p-3"><CheckCircle2 className="text-tcds-goldDeep"/><div><p className="font-black">Authoritative completion required</p><p className="text-sm text-tcds-muted">The server will revalidate claim, reservation, exact scans, row versions, holds, position, and packing destination in one transaction.</p></div></div><PrimaryButton loading={busy} disabled={authoritativeBlocked} onClick={() => void complete()}>Complete Pick & Hand to Packing</PrimaryButton></ScreenCard>}
        {task.blockingReasons.length > 0 && <ScreenCard><h3 className="font-black text-tcds-red">Blocking issues</h3><ul className="mt-2 space-y-2">{task.blockingReasons.map((reason) => <li key={reason} className="rounded-xl bg-red-50 p-2 text-sm font-semibold text-tcds-red">{reason}</li>)}</ul></ScreenCard>}
      </>}
    </main></>;
}

function messageFor(error: unknown): string {
  const code = error instanceof Error ? error.message : 'UNKNOWN';
  const messages: Record<string,string> = { SESSION_EXPIRED: 'Your secure session expired. Sign in again to resume this claimed task.', CONFLICT: 'The pick task changed on another device. Reload before continuing.', STALE_VERSION: 'The task is stale. Refresh to load the latest reservation and item state.', AbortError: 'The warehouse service timed out. No completion was assumed.' };
  return messages[code] || 'The pick operation could not be completed safely. No inventory change was assumed.';
}
