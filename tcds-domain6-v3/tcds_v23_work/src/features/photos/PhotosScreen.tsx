import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import { AppHeader } from '../../components/AppHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ScreenCard } from '../../components/ScreenCard';
import { photoApi } from './services/photoApi';
import { inspectImage, sha256File } from './services/photoFileChecks';
import { listLocalCaptures, saveLocalCapture } from './services/photoLocalQueue';
import type { CompletionGate, PhotoRequirement, PhotoSession } from './types/photoTypes';
import { PhotoRequirementCard } from './components/PhotoRequirementCard';
import { PhotoStatusPanel } from './components/PhotoStatusPanel';

export function PhotosScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionId = params.get('session');
  const [session, setSession] = useState<PhotoSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PhotoRequirement | null>(null);
  const [localCount, setLocalCount] = useState(0);
  const [gate, setGate] = useState<CompletionGate | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = async () => {
    if (!sessionId) { setError('Photo session reference is missing. Return to Receive and reopen the item.'); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const value = await photoApi.loadSession(sessionId);
      setSession(value);
      setLocalCount((await listLocalCaptures(sessionId)).length);
    } catch (e) {
      setError(e instanceof Error && e.message === 'SESSION_CONFLICT' ? 'This photo session is active on another device. A manager may authorize a takeover.' : 'Unable to load the photo session. Your existing local captures remain protected.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, [sessionId]);

  const required = useMemo(() => session?.requirements.filter(r => r.requirementClass !== 'OPTIONAL') ?? [], [session]);
  const accepted = required.filter(r => r.state === 'ACCEPTED' || r.state === 'OVERRIDDEN').length;

  const beginCapture = (requirement: PhotoRequirement) => { setSelected(requirement); fileInput.current?.click(); };

  const onFile = async (file?: File) => {
    if (!file || !session || !selected) return;
    const localId = crypto.randomUUID();
    try {
      const image = await inspectImage(file);
      if (image.width < selected.minimumWidth || image.height < selected.minimumHeight) throw new Error('RESOLUTION_TOO_LOW');
      const sha256 = await sha256File(file);
      await saveLocalCapture({ id: localId, sessionId: session.photoSessionId, requirementId: selected.requirementId, createdAt: new Date().toISOString(), file, fileName: file.name, contentType: file.type, sha256, state: navigator.onLine ? 'CAPTURED_LOCAL' : 'QUEUED_OFFLINE' });
      setLocalCount((x) => x + 1);
      setSession((s) => s ? ({ ...s, requirements: s.requirements.map(r => r.requirementId === selected.requirementId ? { ...r, state: navigator.onLine ? 'CAPTURED_LOCAL' : 'QUEUED_OFFLINE', localQueueId: localId, localCopyRetained: true, rejectionReasons: [] } : r) }) : s);
      if (!navigator.onLine) return;
      const auth = await photoApi.authorizeUpload(session.photoSessionId, selected.requirementId, file, sha256);
      await fetch(auth.uploadUrl, { method: 'PUT', body: file, headers: auth.headers });
      const updated = await photoApi.completeUpload(session.photoSessionId, { uploadId: auth.uploadId, requirementId: selected.requirementId, sha256, width: image.width, height: image.height, route: auth.route, localQueueId: localId });
      setSession(updated);
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'CAPTURE_FAILED';
      setSession((s) => s ? ({ ...s, requirements: s.requirements.map(r => r.requirementId === selected.requirementId ? { ...r, state: 'PREFLIGHT_FAILED', rejectionReasons: [reason] } : r) }) : s);
    } finally { setSelected(null); if (fileInput.current) fileInput.current.value = ''; }
  };

  const checkCompletion = async () => {
    if (!session) return;
    setGate(await photoApi.completionCheck(session.photoSessionId));
  };

  const complete = async () => {
    if (!session) return;
    const result = await photoApi.completeSession(session.photoSessionId);
    setGate(result);
    if (result.gatePassed && result.nextWorkflow) navigate(`${result.nextWorkflow.route}?workflow=${encodeURIComponent(result.nextWorkflow.workflowToken)}`);
  };

  if (loading) return <><AppHeader title="Capture Photos" subtitle="Loading photo requirements…" /><div className="mx-auto max-w-md p-4"><div className="skeleton h-64 rounded-enterprise" /></div></>;

  if (!session) return <><AppHeader title="Capture Photos" subtitle="Required evidence before inventory acceptance" /><div className="mx-auto max-w-md p-4"><ScreenCard><div className="text-center"><AlertTriangle className="mx-auto text-tcds-red"/><h2 className="mt-3 font-display text-card font-black">Photo session unavailable</h2><p className="mt-2 text-sm text-tcds-muted">{error}</p><button onClick={() => void reload()} className="tcds-focus mt-4 rounded-xl border border-tcds-line px-4 py-3 font-black"><RefreshCw className="mr-2 inline" size={16}/>Retry safely</button></div></ScreenCard></div></>;

  return <><AppHeader title="Capture Photos" subtitle="Required evidence before inventory acceptance" />
    <main className="mx-auto max-w-md space-y-4 p-4">
      <ScreenCard>
        <div className="flex items-start justify-between gap-3"><div><p className="text-caption font-black uppercase tracking-[.22em] text-tcds-gold">Digital Twin</p><h2 className="mt-1 font-display text-card font-black text-tcds-ink">{session.internalBarcode}</h2><p className="text-sm font-semibold text-tcds-muted">{session.productTitle}</p></div><span className="rounded-full bg-tcds-gold/10 px-3 py-1 text-xs font-black text-tcds-goldDeep">Profile v{session.profileVersion}</span></div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-tcds-surface p-2"><b>{accepted}/{required.length}</b><br/>Accepted</div><div className="rounded-xl bg-tcds-surface p-2"><b>{session.stationCode}</b><br/>Station</div><div className="rounded-xl bg-tcds-surface p-2"><b>{session.status}</b><br/>Session</div></div>
      </ScreenCard>

      {!session.connectivity.online && <div className="rounded-enterprise border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900"><LockKeyhole className="mr-2 inline" size={17}/>Offline capture is protected locally. Final acceptance and workflow advancement are blocked until synchronization completes.</div>}

      <ScreenCard>
        <div className="mb-4 flex items-center justify-between"><div><h2 className="font-display text-section font-black text-tcds-ink">Required Evidence</h2><p className="text-sm text-tcds-muted">Each artifact must be uploaded, committed, integrity-checked, and accepted.</p></div><ShieldCheck className="text-tcds-gold"/></div>
        <div className="grid grid-cols-2 gap-3">{session.requirements.sort((a,b) => a.sequenceNo-b.sequenceNo).map(r => <PhotoRequirementCard key={r.requirementId} requirement={r} onCapture={beginCapture} onReview={(req) => void photoApi.requestReview(session.photoSessionId, req.requirementId, 'Operator requested manual review')} />)}</div>
      </ScreenCard>

      <PhotoStatusPanel session={session} localCount={localCount} />

      {gate && !gate.gatePassed && <ScreenCard><h3 className="font-display text-card font-black text-tcds-red">Completion blocked</h3><ul className="mt-3 space-y-2">{gate.blockingIssues.map(x => <li key={x} className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-tcds-red">{x}</li>)}</ul></ScreenCard>}
      {gate?.gatePassed && <div className="success-pop rounded-enterprise border border-green-200 bg-green-50 p-4 text-sm font-bold text-tcds-green"><CheckCircle2 className="mr-2 inline"/>All required artifacts passed the authoritative completion gate.</div>}

      <div className="space-y-3"><PrimaryButton onClick={() => void checkCompletion()} disabled={!session.connectivity.online}>Run Completion Gate</PrimaryButton><PrimaryButton onClick={() => void complete()} disabled={!gate?.gatePassed} success={gate?.gatePassed}>Complete Photos & Continue</PrimaryButton></div>

      <input ref={fileInput} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
    </main></>;
}
