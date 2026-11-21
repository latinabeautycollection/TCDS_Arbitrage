import { useEffect, useState } from 'react';
import { Box, Lock, PackageCheck, ShieldCheck, UserCheck } from 'lucide-react';
import { PrimaryButton } from '../../../components/PrimaryButton';
import { PackShipApiError, packShipApi, type OperationContext } from '../services/packShipApi';
import type { PackagingOptions, PackShipTask } from '../types/packShipTypes';
import type { PackShipActionOutcome } from '../scanning/packShipRetry';
import { canChooseBox, canMeasure, canSeal, checkMeasurements, claimView, holdsClaim, type MeasurementDraft } from '../controls/packShipControlState';

/**
 * Pack/Ship business controls (Domain 6, owned by Praise / TCDS dev team): Claim, Select Box, Measurements, Seal.
 * Each control hands the screen one submit function; the screen binds it to one operation identity
 * (bindPackShipManualOperation) so a timed-out attempt is retried as the same operation, and applies the returned
 * task snapshot through its monotonic gate. No control decides business truth: the database authorizes every write.
 */
export type ControlSubmit = (
  submit: (operation: OperationContext) => Promise<PackShipTask>,
  successTitle: string,
  successDetail?: string,
  onSettled?: (outcome: PackShipActionOutcome) => void,
) => void;

type Props = { task: PackShipTask; disabled: boolean; onSubmit: ControlSubmit };

const when = (iso: string | null | undefined) => {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
};

export function ClaimTaskCard({ task, disabled, onSubmit }: Props) {
  const view = claimView(task);
  if (view.kind === 'NOT_CLAIMABLE') return null;
  const taskId = task.taskId;
  const claim = () => onSubmit((op) => packShipApi.claim(taskId, op), 'Task claimed', 'This task is reserved for you on this device.');
  return <section aria-label="Task claim" className="rounded-2xl border border-tcds-line bg-white p-4">
    <div className="flex items-center gap-2"><UserCheck size={18} className="text-tcds-gold"/><p className="text-xs font-black uppercase tracking-[.14em] text-tcds-muted">Task claim</p></div>
    {view.kind === 'HELD' && <p className="mt-1 font-black text-tcds-green">Claimed by you{view.expiresAt ? ` · until ${when(view.expiresAt)}` : ''}</p>}
    {view.kind === 'HELD_BY_OTHER' && <><p className="mt-1 font-black text-tcds-warning">Another packer has this task{view.expiresAt ? ` until ${when(view.expiresAt)}` : ''}</p><p className="mt-1 text-xs text-tcds-muted">Open a different task, or ask a supervisor.</p></>}
    {(view.kind === 'UNCLAIMED' || view.kind === 'EXPIRED') && <>
      <p className="mt-1 text-sm text-tcds-muted">{view.kind === 'EXPIRED' ? 'The previous claim expired. Claim the task to continue on this device.' : 'Claim the task before scanning the source.'}</p>
      <PrimaryButton className="mt-3" disabled={disabled} onClick={claim}>{view.kind === 'EXPIRED' ? 'Take Over Task' : 'Claim Task'}</PrimaryButton>
    </>}
  </section>;
}

type OptionsState = { status: 'idle' | 'loading' | 'error'; data?: PackagingOptions; error?: string };

export function PackagingSelector({ task, disabled, onSubmit }: Props) {
  const open = canChooseBox(task);
  const [state, setState] = useState<OptionsState>({ status: 'idle' });
  const [chosen, setChosen] = useState('');
  const [reload, setReload] = useState(0);
  const taskId = task.taskId, rowVersion = task.rowVersion;

  useEffect(() => {
    if (!open) { setState({ status: 'idle' }); setChosen(''); return; }
    let live = true;
    setState({ status: 'loading' });
    packShipApi.getPackagingOptions(taskId).then((data) => {
      if (!live) return;
      // A list for another task, or with a malformed id, is never offered.
      if (data?.taskId !== taskId || !Array.isArray(data.options)) { setState({ status: 'error', error: 'CROSS_TASK_RESPONSE_BLOCKED' }); return; }
      setState({ status: 'idle', data });
      setChosen((c) => (data.options.some((o) => o.profileId === c) ? c : ''));
    }).catch((e) => { if (live) setState({ status: 'error', error: e instanceof PackShipApiError ? e.code : 'UNKNOWN_ERROR' }); });
    return () => { live = false; };
  }, [open, taskId, rowVersion, reload]);

  if (task.packageId) return <div className="mt-3 rounded-2xl border border-tcds-green/30 bg-tcds-green/10 p-3"><div className="flex items-center gap-2"><Box size={18} className="text-tcds-green"/><p className="font-black">Box selected</p></div>{task.packageBarcode && <p className="mt-1 text-sm text-tcds-muted">Package {task.packageBarcode}</p>}</div>;
  if (!open) return <p className="mt-3 text-sm text-tcds-muted">{holdsClaim(task) ? 'Box selection opens once the source and every item are verified.' : 'Claim the task to choose a box.'}</p>;

  const data = state.data;
  const select = () => {
    const option = data?.options.find((o) => o.profileId === chosen);
    if (!option) return;
    const profileId = option.profileId;
    onSubmit((op) => packShipApi.selectPackage(taskId, profileId, undefined, rowVersion, op), 'Box selected', option.profileName);
  };
  return <div className="mt-3" aria-label="Choose a box">
    <p className="text-xs font-black uppercase tracking-[.14em] text-tcds-muted">Eligible boxes</p>
    {state.status === 'loading' && <p className="mt-2 text-sm text-tcds-muted">Loading eligible boxes…</p>}
    {state.status === 'error' && <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm"><p className="font-black">Eligible boxes could not be loaded</p><button className="mt-1 font-black underline" onClick={() => setReload((n) => n + 1)}>Try again</button></div>}
    {data && data.options.length === 0 && <p role="status" className="mt-2 rounded-xl bg-tcds-surface p-3 text-sm font-semibold">No eligible box for this task. Ask a supervisor before packing.</p>}
    {data && data.options.length > 0 && <fieldset className="mt-2 space-y-2"><legend className="sr-only">Box</legend>
      {data.options.map((o) => <label key={o.profileId} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border p-3 ${chosen === o.profileId ? 'border-tcds-gold bg-tcds-gold/10' : 'border-tcds-line bg-white'}`}>
        <input type="radio" name="packaging-profile" value={o.profileId} checked={chosen === o.profileId} onChange={() => setChosen(o.profileId)} disabled={disabled}/>
        <span><span className="block font-black">{o.profileName}</span><span className="block text-xs text-tcds-muted">{o.profileCode}{o.maximumWeightOz != null ? ` · up to ${o.maximumWeightOz} oz` : ''}</span></span>
      </label>)}
    </fieldset>}
    {data && data.options.length > 0 && <PrimaryButton className="mt-3" disabled={disabled || !chosen || !data.selectable} onClick={select}>Use This Box</PrimaryButton>}
  </div>;
}

const EMPTY: MeasurementDraft = { pounds: '', ounces: '', lengthIn: '', widthIn: '', heightIn: '' };

export function MeasurementForm({ task, disabled, onSubmit }: Props) {
  const [draft, setDraft] = useState<MeasurementDraft>(EMPTY);
  const [invalid, setInvalid] = useState<string | null>(null);
  useEffect(() => { setDraft(EMPTY); setInvalid(null); }, [task.taskId, task.packageId]);
  if (!canMeasure(task)) return null;
  const approval = task.manualWeightApproval ?? null;
  const set = (k: keyof MeasurementDraft) => (e: { target: { value: string } }) => { setDraft((d) => ({ ...d, [k]: e.target.value })); setInvalid(null); };
  const save = () => {
    if (!approval) return;
    const checked = checkMeasurements(draft);
    if (!checked.ok) { setInvalid(checked.field); return; }
    const { taskId, rowVersion } = task; const packageId = task.packageId as string; const packageRowVersion = task.packageRowVersion as number;
    const overrideDecisionId = approval.overrideDecisionId;
    // Saved values show in the Weight / Dimensions tiles above; the emptied form (Save inactive) is only for a correction.
    onSubmit((op) => packShipApi.saveMeasurements(taskId, rowVersion, packageId, packageRowVersion, checked.value, { type: 'MANUAL', overrideDecisionId }, op), 'Measurements saved', undefined,
      (outcome) => { if (outcome === 'ok') { setDraft(EMPTY); setInvalid(null); } });
  };
  // Save stays inactive until a weight and all three dimensions are entered.
  const complete = !!(draft.pounds.trim() || draft.ounces.trim()) && !!draft.lengthIn.trim() && !!draft.widthIn.trim() && !!draft.heightIn.trim();
  const field = (k: keyof MeasurementDraft, label: string, name: string) => <label className="block"><span className="text-[10px] font-black uppercase tracking-[.14em] text-tcds-muted">{label}</span>
    <input aria-label={label} aria-invalid={invalid === name} inputMode="decimal" autoComplete="off" value={draft[k]} onChange={set(k)} disabled={disabled}
      className={`mt-1 min-h-12 w-full rounded-xl border px-3 text-base ${invalid === name ? 'border-tcds-red' : 'border-tcds-line'}`}/></label>;
  return <div className="mt-3 space-y-3" aria-label="Enter measurements">
    <div className="rounded-2xl bg-tcds-surface p-3 text-sm">
      {approval
        ? <p className="flex items-center gap-2 font-black text-tcds-green"><ShieldCheck size={16}/> Manual weight approved by a supervisor</p>
        : <><p className="flex items-center gap-2 font-black text-tcds-warning"><Lock size={16}/> Supervisor approval needed</p><p className="mt-1 text-xs text-tcds-muted">No scale is connected. A supervisor (not you) must approve a manual weight for this package before it can be saved. Refresh once it is approved.</p></>}
    </div>
    <div className="grid grid-cols-2 gap-2">{field('pounds', 'Weight (lb)', 'weight')}{field('ounces', 'Weight (oz)', 'weight')}</div>
    <div className="grid grid-cols-3 gap-2">{field('lengthIn', 'Length (in)', 'length')}{field('widthIn', 'Width (in)', 'width')}{field('heightIn', 'Height (in)', 'height')}</div>
    {invalid && <p role="alert" className="text-xs font-black text-tcds-red">{invalid === 'weight' ? 'Enter a weight above 0 (ounces under 16 when pounds are given).' : `Enter the ${invalid} in inches (above 0, up to 240).`}</p>}
    <PrimaryButton disabled={disabled || !approval || !complete} onClick={save}>Save Measurements</PrimaryButton>
  </div>;
}

export function SealPackageCard({ task, disabled, onSubmit }: Props) {
  if (task.sealed) return <p className="mt-3 flex items-center gap-2 rounded-2xl bg-tcds-green/10 p-3 font-black text-tcds-green"><PackageCheck size={18}/> Package sealed</p>;
  if (task.taskStatus !== 'EVIDENCE_PENDING' || !holdsClaim(task)) return null;
  const ready = canSeal(task);
  const seal = () => {
    const { taskId, rowVersion } = task; const packageId = task.packageId as string; const packageRowVersion = task.packageRowVersion as number;
    onSubmit((op) => packShipApi.seal(taskId, rowVersion, packageId, packageRowVersion, op), 'Package sealed', 'Next: the carrier label.');
  };
  return <div className="mt-3" aria-label="Seal package">
    {!ready && <p className="text-sm text-tcds-muted">Sealing opens when contents, measurements and evidence all pass.</p>}
    <PrimaryButton className="mt-2" disabled={disabled || !ready} onClick={seal}>Seal Package</PrimaryButton>
  </div>;
}
