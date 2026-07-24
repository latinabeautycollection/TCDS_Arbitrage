import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Box, Camera, PackageCheck, RefreshCw, Scale, ScanLine, Truck } from 'lucide-react';
import { AppHeader } from '../../components/AppHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ScreenCard } from '../../components/ScreenCard';
import { PackShipApiError, packShipApi } from './services/packShipApi';
import type { PackShipTask, RateOption } from './types/packShipTypes';
import type { PackShipMessage } from './types/packShipMessages';
import { resolvePackShipMessage } from './messages/packShipMessageCatalog';
import { CompletionGateCard } from './components/CompletionGateCard';
import { IdentityCards } from './components/IdentityCards';
import { ProgressRail } from './components/ProgressRail';
import { ReadinessGrid } from './components/ReadinessGrid';
import { WorkflowMessageBanner } from './components/WorkflowMessageBanner';
import { InlineFieldGuidance } from './components/InlineFieldGuidance';
import { GuidanceCard } from './components/GuidanceCard';
import { MessageDetailSheet } from './components/MessageDetailSheet';
import { PackShipToast } from './components/PackShipToast';

type ToastState = { title: string; detail?: string } | null;

export function PackShipScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const taskId = params.get('taskId') || '';
  const [task, setTask] = useState<PackShipTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<PackShipMessage | null>(null);
  const [detailMessage, setDetailMessage] = useState<PackShipMessage | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [scanValue, setScanValue] = useState('');
  const [trackingScan, setTrackingScan] = useState('');
  const [packageScan, setPackageScan] = useState('');
  const [outboundScan, setOutboundScan] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const lastOperation = useRef<null | (() => Promise<PackShipTask>)>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  const showApiError = (error: unknown) => {
    const apiError = error instanceof PackShipApiError ? error : new PackShipApiError('UNKNOWN_ERROR');
    const resolved = resolvePackShipMessage(apiError.code, apiError.supportReference, apiError.messageOverride);
    setMessage(resolved);
    if (resolved.presentation === 'SHEET') setDetailMessage(resolved);
  };

  const load = useCallback(async () => {
    if (!taskId) { setMessage(resolvePackShipMessage('UNKNOWN_ERROR', undefined, { title:'Packing task required', explanation:'A valid packing-task handoff was not supplied.', nextAction:'Return to the packing queue and open an assigned task.', primaryActionLabel:'Return to Dashboard' })); setLoading(false); return; }
    setLoading(true); setMessage(null);
    try { setTask(await packShipApi.getTask(taskId)); }
    catch (error) { showApiError(error); }
    finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), 4000); return () => window.clearTimeout(id); }, [toast]);

  const mutate = async (operation: () => Promise<PackShipTask>, successTitle: string, successDetail?: string) => {
    setBusy(true); setMessage(null); lastOperation.current = operation;
    try { setTask(await operation()); setToast({ title: successTitle, detail: successDetail }); }
    catch (error) { showApiError(error); }
    finally { setBusy(false); }
  };

  const retryLast = () => { if (lastOperation.current) void mutate(lastOperation.current, 'Action completed'); else void load(); };
  const selectedRate = useMemo(() => task?.rates.find((r) => r.quoteId === task.selectedQuoteId), [task]);
  const allReady = task ? Object.values(task.readiness).every((v) => v === 'READY') : false;
  const canStage = task?.carrierLabel.status === 'SCAN_VERIFIED' && task.completionGates.every((g) => !g.blocking || g.state === 'PASS');
  const shipmentId = task?.shipmentId || '';
  const inline = (field: PackShipMessage['field']) => message?.presentation === 'INLINE' && message.field === field ? message : null;
  const banner = message?.presentation === 'BANNER' ? message : task?.operationalMessages?.find((m) => m.presentation === 'BANNER' && m.blocking) || null;

  const handlePrimary = () => {
    if (!message) return;
    if (message.code === 'SESSION_EXPIRED') navigate('/login', { state: { returnTo: `/pack-ship?taskId=${taskId}` } });
    else if (message.code === 'PACK_EVIDENCE_MISSING') navigate(`/photos?mode=PACKING_EVIDENCE&taskId=${encodeURIComponent(taskId)}`);
    else retryLast();
  };

  if (loading) return <><AppHeader title="Pack & Ship" subtitle="Loading packing custody…"/><div className="mx-auto max-w-md p-4"><div className="skeleton h-80 rounded-[2rem]"/></div></>;
  if (!task) return <><AppHeader title="Pack & Ship" subtitle="Packing custody unavailable"/><div className="mx-auto max-w-md p-4"><ScreenCard><AlertTriangle className="text-tcds-red"/><h2 className="mt-3 font-display text-xl font-black">Packing task required</h2><p className="mt-2 text-sm text-tcds-muted">Return to the packing queue and open an assigned task.</p><PrimaryButton onClick={() => navigate('/dashboard')}>Return to Dashboard</PrimaryButton></ScreenCard></div></>;

  return <><AppHeader title="Pack & Ship" subtitle="Packing custody → shipping authorization" />
    {toast && <PackShipToast title={toast.title} detail={toast.detail} onDismiss={() => setToast(null)}/>} 
    <div aria-live="assertive" className="sr-only">{message?.announce}</div>
    <div className="mx-auto max-w-md space-y-4 p-4 pb-28">
      {!online && <WorkflowMessageBanner message={resolvePackShipMessage('NETWORK_ERROR', undefined, { title:'Offline — carrier and shipment actions are blocked', explanation:'Downloaded instructions remain visible, but task state and carrier information may be stale.', nextAction:'Reconnect before confirming contents, sealing, purchasing a label, printing, or staging the package.' })} onPrimary={() => void load()} onDetails={() => setDetailMessage(resolvePackShipMessage('NETWORK_ERROR'))}/>} 
      {banner && <WorkflowMessageBanner message={banner} onPrimary={handlePrimary} onSecondary={() => setDetailMessage(banner)} onDetails={() => setDetailMessage(banner)}/>} 

      <ScreenCard>
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-tcds-gold">Packing Task</p><h2 className="font-display text-xl font-black text-tcds-ink">{task.taskNumber}</h2><p className="text-sm text-tcds-muted">Order {task.orderNumber} · {task.stationCode}</p></div><button onClick={() => void load()} className="tcds-focus rounded-xl border border-tcds-line p-2" aria-label="Refresh packing task"><RefreshCw size={18}/></button></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><Metric label="Employee" value={task.employeeName}/><Metric label="Carrier cutoff" value={task.carrierCutoffAt || 'Not assigned'}/></div>
        <div className="mt-4"><ReadinessGrid readiness={task.readiness}/></div>
      </ScreenCard>

      <ProgressRail stage={task.stage}/><IdentityCards task={task}/>

      <section id="stage-contents"><ScreenCard>
        <h3 className="font-display text-lg font-black">Exact Contents Verification</h3>
        <GuidanceCard what={task.sourceVerified ? 'Scan each exact TCDS item barcode.' : 'Scan the tote or packing-stage barcode.'} why="This proves the correct picked custody and exact serialized contents are at this station." next={task.sourceVerified ? 'Confirm every expected item.' : 'Scan the first expected item.'}/>
        <div className="mt-3 rounded-2xl bg-tcds-black p-4 text-white"><p className="text-xs font-black uppercase tracking-[.16em] text-tcds-gold">Expected contents</p><p className="mt-1 text-3xl font-black">{task.items.filter((i) => i.verified).length} / {task.items.length}</p><p className="mt-2 text-sm text-white/60">Exact serialized units only. Matching SKU substitution is blocked.</p></div>
        <div className="mt-3 space-y-2">{task.items.map((item) => <div key={item.itemId} className="rounded-2xl border border-tcds-line p-3"><div className="flex justify-between gap-3"><div><p className="font-black">{item.title}</p><p className="text-xs text-tcds-muted">{item.internalBarcode}{item.serialEnding ? ` · …${item.serialEnding}` : ''}</p></div><span className={`text-xs font-black ${item.verified ? 'text-tcds-green' : 'text-tcds-warning'}`}>{item.verified ? 'VERIFIED' : 'PENDING'}</span></div></div>)}</div>
        <div className="mt-3 flex gap-2"><input aria-label="Scan tote or item barcode" value={scanValue} onChange={(e) => setScanValue(e.target.value)} className="min-h-14 flex-1 rounded-2xl border border-tcds-line px-4 text-base" placeholder={task.sourceVerified ? 'Scan exact TCDS item' : 'Scan tote or pack stage'}/><button aria-label="Submit scan" disabled={!scanValue || busy || !online} onClick={() => void mutate(() => task.sourceVerified ? packShipApi.scanItem(task.taskId, scanValue, task.rowVersion) : packShipApi.scanSource(task.taskId, scanValue, task.rowVersion), task.sourceVerified ? 'Item verified' : 'Packing custody confirmed')} className="rounded-2xl bg-tcds-black px-4 text-white"><ScanLine/></button></div><InlineFieldGuidance message={inline('scan')}/>
      </ScreenCard></section>

      <section id="stage-packaging"><ScreenCard>
        <h3 className="font-display text-lg font-black">Packaging Recommendation</h3>
        <GuidanceCard what="Use the approved package and protection profile." why="The profile balances damage prevention, dimensional weight, battery rules, and shipping cost." next="Create and measure the sealed TCDS package."/>
        {task.packaging ? <div className="mt-3 rounded-2xl border border-tcds-gold/30 bg-tcds-gold/10 p-4"><div className="flex items-center gap-2"><Box className="text-tcds-goldDeep"/><p className="font-black">{task.packaging.packageCode}</p><span className="ml-auto text-xs font-black">{Math.round(task.packaging.confidence * 100)}%</span></div><p className="mt-2 text-sm font-semibold">{task.packaging.description}</p><ul className="mt-2 space-y-1 text-sm text-tcds-muted">{task.packaging.protection.map((x) => <li key={x}>✓ {x}</li>)}</ul></div> : <p className="mt-2 text-sm text-tcds-muted">Recommendation will load after contents are verified.</p>}
      </ScreenCard></section>

      <section id="stage-measurements"><ScreenCard>
        <h3 className="font-display text-lg font-black">Package Measurement</h3>
        <GuidanceCard what="Place the completed package on the scale and confirm all three dimensions." why="Measured values control service availability, protection rules, and dimensional shipping cost." next="Capture packing evidence and seal the package."/>
        <div className="mt-3 grid grid-cols-2 gap-2"><Metric icon={<Scale size={18}/>} label="Weight" value={task.measurement.weightLb ? `${task.measurement.weightLb} lb` : 'Pending'}/><Metric icon={<PackageCheck size={18}/>} label="Dimensions" value={task.measurement.lengthIn ? `${task.measurement.lengthIn}×${task.measurement.widthIn}×${task.measurement.heightIn} in` : 'Pending'}/></div>
        <p className="mt-3 text-xs font-semibold text-tcds-muted">Source: {task.measurement.source} · Stable reading: {task.measurement.stable ? 'Yes' : 'No'}</p><InlineFieldGuidance message={inline('weight') || inline('length') || inline('width') || inline('height')}/>
      </ScreenCard></section>

      <section id="stage-evidence"><ScreenCard>
        <h3 className="font-display text-lg font-black">Packing Evidence</h3><GuidanceCard what="Capture every required artifact before sealing." why="Evidence protects TCDS in carrier, customer, return, and fraud disputes." next="The system validates hashes and image quality before shipping authorization."/>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center"><Metric label="Required" value={String(task.evidence.required)}/><Metric label="Accepted" value={String(task.evidence.accepted)}/><Metric label="Pending" value={String(task.evidence.pending)}/><Metric label="Rejected" value={String(task.evidence.rejected)}/></div>
        <button onClick={() => navigate(`/photos?mode=PACKING_EVIDENCE&taskId=${encodeURIComponent(task.taskId)}`)} className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-tcds-line bg-white font-black"><Camera size={18}/> Capture Packing Evidence</button>
      </ScreenCard></section>

      <section id="stage-address"><ScreenCard>
        <h3 className="font-display text-lg font-black">Address & Protection</h3><GuidanceCard what="Validate the destination and review any carrier correction." why="Label purchase is blocked until one deliverable address and all protection requirements are approved." next="Retrieve ranked carrier options."/>
        <div className="mt-3 rounded-2xl bg-tcds-surface p-3"><p className="text-xs font-black uppercase tracking-[.14em] text-tcds-muted">Address</p><p className="mt-1 font-black">{task.address.status}</p>{task.address.entered && task.address.normalized && task.address.entered !== task.address.normalized && <div className="mt-2 text-sm"><p><strong>Entered:</strong> {task.address.entered}</p><p><strong>Carrier normalized:</strong> {task.address.normalized}</p></div>}{task.address.normalized && !task.address.entered && <p className="mt-1 text-sm text-tcds-muted">{task.address.normalized}</p>}</div>
        <div className="mt-2 rounded-2xl bg-tcds-surface p-3"><p className="text-xs font-black uppercase tracking-[.14em] text-tcds-muted">Protection policy</p><p className="mt-1 font-black">${task.protection.declaredValue.toFixed(2)} · {task.protection.routing}</p><p className="mt-1 text-sm text-tcds-muted">Insurance {task.protection.insuranceRequired ? 'required' : 'not required'} · Signature {task.protection.signatureRequired ? 'required' : 'not required'}</p></div><InlineFieldGuidance message={inline('address')}/>
      </ScreenCard></section>

      <section id="stage-rates"><ScreenCard><h3 className="font-display text-lg font-black">Carrier Options</h3><GuidanceCard what="Select the approved service recommended by Domain 3." why="The ranking considers cost, delivery confidence, loss risk, insurance, signature, and profit impact." next="Authorize one idempotent carrier-label purchase."/><div className="mt-3 space-y-2">{task.rates.length ? task.rates.map((rate) => <RateCard key={rate.quoteId} rate={rate} selected={rate.quoteId === task.selectedQuoteId} onSelect={() => void mutate(() => packShipApi.selectRate(shipmentId, rate.quoteId), 'Carrier service selected', `${rate.carrier} ${rate.service}`)}/>) : <p className="text-sm text-tcds-muted">Rates appear after packing, measurements, address validation, and risk evaluation pass.</p>}</div><InlineFieldGuidance message={inline('rate')}/></ScreenCard></section>

      <ScreenCard><h3 className="font-display text-lg font-black">Shipping Authorization</h3><p className="mt-1 text-sm text-tcds-muted">External carrier calls occur outside the packing transaction and remain idempotent.</p><div className="mt-3 grid grid-cols-2 gap-2"><Action label="Validate Address" disabled={!shipmentId || busy || !online} onClick={() => void mutate(() => packShipApi.validateAddress(shipmentId), 'Address validation completed')}/><Action label="Evaluate Risk" disabled={!shipmentId || busy || !online} onClick={() => void mutate(() => packShipApi.evaluateRisk(shipmentId), 'Shipping risk evaluated')}/><Action label="Retrieve Rates" disabled={!shipmentId || busy || !online} onClick={() => void mutate(() => packShipApi.getRates(shipmentId), 'Rate options refreshed')}/><Action label="Purchase Label" disabled={!shipmentId || !task.selectedQuoteId || busy || !online} onClick={() => void mutate(() => packShipApi.purchaseLabel(shipmentId), 'Carrier label purchased', 'Print and scan-verify the existing label before outbound staging.')}/></div></ScreenCard>

      <section id="stage-label"><ScreenCard>
        <h3 className="font-display text-lg font-black">Carrier Label & Outbound</h3><GuidanceCard what="Print and apply the existing carrier label, then scan both identities." why="The package barcode proves the carton; the tracking barcode proves the carrier shipment." next="Scan the approved outbound staging location."/>
        <div className="mt-3 rounded-2xl bg-tcds-black p-4 text-white"><div className="flex items-center gap-2"><Truck className="text-tcds-gold"/><p className="font-black">{task.carrierLabel.status}</p></div><p className="mt-2 text-sm text-white/60">{task.carrierLabel.trackingNumber || 'Tracking is created only after an idempotent label purchase.'}</p></div>
        {selectedRate && <p className="mt-3 text-sm font-semibold">Selected: {selectedRate.carrier} {selectedRate.service} · {selectedRate.currency} {selectedRate.totalCost.toFixed(2)}</p>}
        <button disabled={!shipmentId || task.carrierLabel.status !== 'LABEL_PURCHASED' || busy || !online} onClick={() => void mutate(() => packShipApi.printLabel(shipmentId), 'Label print queued', 'Use the existing purchased label; do not repurchase it.')} className="mt-3 min-h-14 w-full rounded-2xl border border-tcds-line bg-white font-black">Print through Device Gateway</button>
        <div className="mt-3 space-y-2"><input aria-label="Carrier tracking barcode" value={trackingScan} onChange={(e) => setTrackingScan(e.target.value)} className="min-h-14 w-full rounded-2xl border border-tcds-line px-4 text-base" placeholder="Scan carrier tracking barcode"/><InlineFieldGuidance message={inline('tracking')}/><input aria-label="TCDS package barcode" value={packageScan} onChange={(e) => setPackageScan(e.target.value)} className="min-h-14 w-full rounded-2xl border border-tcds-line px-4 text-base" placeholder="Scan TCDS package barcode"/><InlineFieldGuidance message={inline('package')}/><button disabled={!shipmentId || !trackingScan || !packageScan || busy || !online} onClick={() => void mutate(() => packShipApi.verifyLabel(shipmentId, trackingScan, packageScan), 'Package and tracking verified')} className="min-h-14 w-full rounded-2xl bg-tcds-black font-black text-white">Verify Package ↔ Tracking Link</button></div>
      </ScreenCard></section>

      <section id="stage-outbound"><ScreenCard><h3 className="font-display text-lg font-black">Authoritative Completion Gate</h3><p className="mt-1 text-sm text-tcds-muted">Tap a failed gate to jump to the stage that needs attention.</p><div className="mt-3"><CompletionGateCard gates={task.completionGates} onGateSelect={(gate) => { const map: Record<string,string> = { CONTENTS:'stage-contents', PACKAGING:'stage-packaging', MEASUREMENTS:'stage-measurements', EVIDENCE:'stage-evidence', ADDRESS:'stage-address', RATES:'stage-rates', LABEL:'stage-label', OUTBOUND:'stage-outbound' }; document.getElementById(map[gate.stage || ''] || 'stage-outbound')?.scrollIntoView({ behavior:'smooth', block:'start' }); }}/></div></ScreenCard>
        <div className="space-y-2"><input aria-label="Outbound staging location" value={outboundScan} onChange={(e) => setOutboundScan(e.target.value)} className="min-h-14 w-full rounded-2xl border border-tcds-line px-4 text-base" placeholder="Scan outbound staging location"/><InlineFieldGuidance message={inline('outbound')}/><PrimaryButton disabled={busy || !online || !allReady || !canStage || !shipmentId || !outboundScan} onClick={() => void mutate(() => packShipApi.stageOutbound(shipmentId, outboundScan), 'Package staged for carrier handoff')}>Stage Package for Carrier Handoff</PrimaryButton><p className="text-center text-xs font-semibold text-tcds-muted">The item becomes SHIPPED only after carrier acceptance—not when the label is printed.</p></div>
      </section>
    </div>
    <MessageDetailSheet message={detailMessage} onClose={() => setDetailMessage(null)} onPrimary={() => { setDetailMessage(null); handlePrimary(); }} onSecondary={() => setDetailMessage(null)}/>
  </>;
}

function Metric({ icon, label, value }: { icon?: JSX.Element; label: string; value: string }) { return <div className="rounded-2xl bg-tcds-surface p-3">{icon && <span className="text-tcds-gold">{icon}</span>}<p className="mt-1 text-[10px] font-black uppercase tracking-[.14em] text-tcds-muted">{label}</p><p className="font-black text-tcds-ink">{value}</p></div>; }
function Action({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) { return <button disabled={disabled} onClick={onClick} className="min-h-14 rounded-2xl border border-tcds-line bg-white px-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50">{label}</button>; }
function RateCard({ rate, selected, onSelect }: { rate: RateOption; selected: boolean; onSelect: () => void }) { return <button onClick={onSelect} disabled={rate.approvalRequired} className={`w-full rounded-2xl border p-4 text-left disabled:opacity-60 ${selected ? 'border-tcds-gold bg-tcds-gold/10' : 'border-tcds-line bg-white'}`}><div className="flex justify-between gap-3"><div><p className="font-black">{rate.carrier} {rate.service}</p><p className="text-xs text-tcds-muted">Delivery {rate.estimatedDelivery} · On-time {Math.round(rate.onTimeConfidence * 100)}%</p></div><p className="font-black">{rate.currency} {rate.totalCost.toFixed(2)}</p></div><div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[.12em]"><span>{rate.lossRisk} risk</span><span>Profit {rate.profitImpact >= 0 ? '+' : ''}{rate.profitImpact.toFixed(2)}</span>{rate.recommended && <span className="text-tcds-green">Recommended</span>}{rate.approvalRequired && <span className="text-tcds-warning">Approval required</span>}</div></button>; }
