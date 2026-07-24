import { useMemo, useState } from 'react';
import { AlertTriangle, Camera, ShieldCheck, X } from 'lucide-react';
import { PrimaryButton } from '../../../components/PrimaryButton';
import { createManualAdmission } from '../services/inventoryApi';
import type { ManualAdmissionDraft, ManualAdmissionReason } from '../types/inventoryTypes';

const reasons: ManualAdmissionReason[] = [
  'FOUND_UNRECORDED_ITEM', 'PHYSICAL_COUNT_DISCOVERY', 'SYSTEM_OUTAGE_RECOVERY',
  'LEGACY_INVENTORY_MIGRATION', 'RETURN_WITHOUT_SOURCE_RECORD', 'DISASTER_RECOVERY',
  'INTER_FACILITY_TRANSFER_RECOVERY', 'DONATION_OR_COMPANY_ASSET', 'DATA_CORRECTION', 'OTHER_MANAGER_APPROVED',
];

export function ManualAdmissionSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (itemId: string) => void }) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManualAdmissionDraft>({
    reasonCode: 'FOUND_UNRECORDED_ITEM', justification: '', discoveryLocation: '', title: '', brand: '', model: '',
    quantity: 1, condition: 'UNKNOWN', ownershipClassification: 'UNKNOWN', identifiers: [], evidenceAssetIds: [], foundByEmployeeNumber: '',
  });
  const canContinue = useMemo(() => step === 1 ? draft.justification.trim().length >= 20 : step === 2 ? draft.title.trim().length > 2 && draft.discoveryLocation.trim().length > 1 : draft.evidenceAssetIds.length >= 1, [draft, step]);
  if (!open) return null;

  async function submit() {
    setSubmitting(true); setError(null);
    try { const result = await createManualAdmission(draft); onCreated(result.itemId); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Manual admission failed.'); }
    finally { setSubmitting(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Manager Manual Inventory Admission">
    <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[2rem] border border-tcds-line bg-white p-5 shadow-floating safe-bottom">
      <div className="flex items-start justify-between gap-4"><div><p className="text-caption font-black uppercase tracking-[0.24em] text-tcds-gold">Manager Controlled</p><h2 className="mt-1 font-display text-page font-black text-tcds-ink">Manual Inventory Admission</h2></div><button onClick={onClose} className="rounded-xl border border-tcds-line p-2" aria-label="Close"><X size={18} /></button></div>
      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900"><div className="flex gap-2"><AlertTriangle size={18} className="shrink-0" /><p>This creates a <strong>PROVISIONAL</strong> Digital Twin on <strong>MANUAL_ADMISSION</strong> hold. It cannot be picked, sold, packed, or shipped until remediation gates pass.</p></div></div>
      <div className="mt-4 flex gap-2">{[1,2,3,4].map((n) => <span key={n} className={`h-2 flex-1 rounded-full ${n <= step ? 'bg-tcds-gold' : 'bg-tcds-surface'}`} />)}</div>
      {step === 1 && <div className="mt-5 space-y-4"><label className="block"><span className="text-sm font-black text-tcds-ink">Admission reason</span><select value={draft.reasonCode} onChange={(e) => setDraft({ ...draft, reasonCode: e.target.value as ManualAdmissionReason })} className="mt-2 min-h-14 w-full rounded-2xl border border-tcds-line bg-white px-4 text-base">{reasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label><label className="block"><span className="text-sm font-black">Manager justification</span><textarea value={draft.justification} onChange={(e) => setDraft({ ...draft, justification: e.target.value })} rows={4} className="mt-2 w-full rounded-2xl border border-tcds-line p-4 text-base" placeholder="Explain why the normal receiving record is unavailable (minimum 20 characters)." /></label></div>}
      {step === 2 && <div className="mt-5 grid gap-4"><label><span className="text-sm font-black">Discovery location</span><input value={draft.discoveryLocation} onChange={(e) => setDraft({ ...draft, discoveryLocation: e.target.value })} className="mt-2 min-h-14 w-full rounded-2xl border border-tcds-line px-4 text-base" /></label><label><span className="text-sm font-black">Best-known product description</span><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="mt-2 min-h-14 w-full rounded-2xl border border-tcds-line px-4 text-base" /></label><div className="grid grid-cols-2 gap-3"><label><span className="text-sm font-black">Brand</span><input value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} className="mt-2 min-h-14 w-full rounded-2xl border border-tcds-line px-4 text-base" /></label><label><span className="text-sm font-black">Model</span><input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} className="mt-2 min-h-14 w-full rounded-2xl border border-tcds-line px-4 text-base" /></label></div></div>}
      {step === 3 && <div className="mt-5 space-y-4"><div className="rounded-2xl border border-dashed border-tcds-gold bg-tcds-gold/5 p-6 text-center"><Camera className="mx-auto text-tcds-gold" /><p className="mt-2 font-black">Discovery evidence required</p><p className="mt-1 text-sm text-tcds-muted">Use the hardened Photo Capture workflow for overall and identifier evidence.</p><button onClick={() => setDraft({ ...draft, evidenceAssetIds: ['preview-evidence-reference'] })} className="mt-4 rounded-2xl border border-tcds-line bg-white px-4 py-3 font-black">Attach Evidence Reference</button></div><div className="rounded-2xl bg-tcds-surface p-4 text-sm"><p className="font-black">Mandatory duplicate search</p><p className="mt-1 text-tcds-muted">The server must search active and archived barcode, serial, UPC, source-order, and similar-product records before creation.</p></div></div>}
      {step === 4 && <div className="mt-5 space-y-3"><div className="rounded-2xl border border-tcds-line p-4"><div className="flex items-center gap-2"><ShieldCheck className="text-tcds-gold" /><p className="font-black">Provisional admission summary</p></div><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><dt className="text-tcds-muted">Reason</dt><dd className="font-black text-right">{draft.reasonCode.replaceAll('_',' ')}</dd><dt className="text-tcds-muted">Item</dt><dd className="font-black text-right">{draft.title}</dd><dt className="text-tcds-muted">Location</dt><dd className="font-black text-right">{draft.discoveryLocation}</dd><dt className="text-tcds-muted">Evidence</dt><dd className="font-black text-right">{draft.evidenceAssetIds.length} attached</dd></dl></div>{error && <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}</div>}
      <div className="mt-6 flex gap-3">{step > 1 && <button onClick={() => setStep((value) => value - 1)} className="min-h-14 flex-1 rounded-enterprise border border-tcds-line bg-white font-black">Back</button>}{step < 4 ? <button disabled={!canContinue} onClick={() => setStep((value) => value + 1)} className="min-h-14 flex-1 rounded-enterprise bg-tcds-black font-black text-white disabled:bg-neutral-300">Continue</button> : <PrimaryButton loading={submitting} onClick={() => void submit()}>Create Provisional Item</PrimaryButton>}</div>
    </div>
  </div>;
}
