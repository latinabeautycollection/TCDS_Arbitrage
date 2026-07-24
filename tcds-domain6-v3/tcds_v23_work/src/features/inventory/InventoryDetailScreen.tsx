import { useEffect, useState } from 'react';
import { AlertTriangle, Camera, Clock3, MapPin, MoreHorizontal, ShieldCheck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ScreenCard } from '../../components/ScreenCard';
import { DigitalTwinHealth } from './components/DigitalTwinHealth';
import { InventoryActionSheet } from './components/InventoryActionSheet';
import { InventoryStatusBadge } from './components/InventoryStatusBadge';
import { getInventoryDetail, requestInventoryAction } from './services/inventoryApi';
import type { InventoryAction, InventoryDetailResponse } from './types/inventoryTypes';

export function InventoryDetailScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const itemId = params.get('item');
  const [data, setData] = useState<InventoryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) { setError('No authoritative item reference was supplied.'); setLoading(false); return; }
    const controller = new AbortController();
    getInventoryDetail(itemId, controller.signal).then(setData).catch((caught) => setError(caught instanceof Error ? caught.message : 'Inventory detail failed.')).finally(() => setLoading(false));
    return () => controller.abort();
  }, [itemId]);

  async function runAction(action: InventoryAction) {
    if (!data) return;
    setActionsOpen(false);
    if (action.actionCode === 'MOVE_ITEM') { navigate('/storage', { state: { mode: 'RELOCATION', itemId: data.item.itemId, expectedRowVersion: data.item.rowVersion } }); return; }
    if (action.actionCode === 'ADD_EVIDENCE') { navigate('/photos', { state: { mode: 'ADDITIONAL_EVIDENCE', itemId: data.item.itemId, returnRoute: `/inventory/detail?item=${data.item.itemId}` } }); return; }
    try {
      const result = await requestInventoryAction(data.item.itemId, action.actionCode, {}, data.item.rowVersion);
      setActionMessage(result.message ?? 'Action request accepted.');
      if (result.workflowRoute) navigate(result.workflowRoute, { state: { workflowToken: result.workflowToken } });
    } catch (caught) { setActionMessage(caught instanceof Error ? caught.message : 'Action request failed.'); }
  }

  if (loading) return <><AppHeader title="Inventory Detail" subtitle="Loading authoritative Digital Twin"/><div className="mx-auto max-w-md space-y-3 p-4">{[1,2,3].map((n) => <div key={n} className="skeleton h-40 rounded-enterprise" />)}</div></>;
  if (error || !data) return <><AppHeader title="Inventory Detail" subtitle="Warehouse-only item record"/><div className="mx-auto max-w-md p-4"><div className="rounded-enterprise border border-red-200 bg-red-50 p-5 text-red-800"><p className="font-black">Unable to load item</p><p className="mt-2 text-sm font-semibold">{error ?? 'Item not found.'}</p></div></div></>;

  const { item, position } = data;
  return <>
    <AppHeader title="Inventory Detail" subtitle="Authoritative warehouse Digital Twin" />
    <div className="mx-auto max-w-md space-y-4 p-4">
      <ScreenCard>
        <div className="flex items-start gap-3"><div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-tcds-surface">{item.primaryPhotoUrl ? <img src={item.primaryPhotoUrl} alt="" className="h-full w-full object-cover"/> : <span className="font-black text-tcds-gold">TCDS</span>}</div><div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-wide text-tcds-goldDeep">{item.internalBarcode}</p><h2 className="mt-1 font-display text-page font-black text-tcds-ink">{item.title}</h2><div className="mt-2 flex flex-wrap gap-2"><InventoryStatusBadge status={item.effectiveStatus}/><span className="rounded-full border border-tcds-line px-2.5 py-1 text-[10px] font-black uppercase">{item.provenance.replaceAll('_',' ')}</span></div></div></div>
        <div className="mt-4"><DigitalTwinHealth score={item.digitalTwinHealth}/></div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm"><div className="rounded-2xl bg-tcds-surface p-3"><p className="font-bold text-tcds-muted">Condition</p><p className="font-black">{item.condition}</p></div><div className="rounded-2xl bg-tcds-surface p-3"><p className="font-bold text-tcds-muted">Barcode</p><p className="font-black">{item.barcodeStatus}</p></div><div className="rounded-2xl bg-tcds-surface p-3"><p className="font-bold text-tcds-muted">Verification</p><p className="font-black">{item.verificationConfidence ? `${item.verificationConfidence}%` : '—'}</p></div><div className="rounded-2xl bg-tcds-surface p-3"><p className="font-bold text-tcds-muted">Quantity</p><p className="font-black">{item.quantity}</p></div></div>
      </ScreenCard>

      <ScreenCard>
        <div className="flex items-center gap-2"><MapPin className="text-tcds-gold"/><h3 className="font-display text-section font-black">Current Position</h3></div>
        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm"><dt className="text-tcds-muted">Facility</dt><dd className="font-black text-right">{position.facilityCode}</dd><dt className="text-tcds-muted">Location</dt><dd className="font-black text-right">{[position.zoneCode, position.aisleCode, position.shelfCode, position.binCode].filter(Boolean).join('-') || 'Unassigned'}</dd><dt className="text-tcds-muted">Location health</dt><dd className="font-black text-right">{position.locationHealth}</dd><dt className="text-tcds-muted">Last confirmed</dt><dd className="font-black text-right">{position.lastConfirmedAt ? new Date(position.lastConfirmedAt).toLocaleString() : 'Unknown'}</dd></dl>
        {position.discrepancyState && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900"><div className="flex gap-2"><AlertTriangle size={17}/><p>{position.discrepancyState.replaceAll('_',' ')}</p></div></div>}
      </ScreenCard>

      <ScreenCard>
        <div className="flex items-center gap-2"><Camera className="text-tcds-gold"/><h3 className="font-display text-section font-black">Evidence Integrity</h3></div>
        <div className="mt-4 grid grid-cols-2 gap-3">{data.evidence.map((evidence) => <div key={evidence.evidenceId} className="rounded-2xl border border-tcds-line p-3"><div className="grid h-20 place-items-center rounded-xl bg-tcds-surface">{evidence.thumbnailUrl ? <img src={evidence.thumbnailUrl} className="h-full w-full rounded-xl object-cover" alt=""/> : <ShieldCheck className="text-tcds-gold"/>}</div><p className="mt-2 text-sm font-black">{evidence.label}</p><p className={`mt-1 text-xs font-bold ${evidence.hashIntegrity === 'FAILED' ? 'text-red-700' : 'text-tcds-green'}`}>{evidence.status} · Hash {evidence.hashIntegrity}</p></div>)}</div>
      </ScreenCard>

      {(data.risks.length > 0 || data.remediationTasks.length > 0) && <ScreenCard><h3 className="font-display text-section font-black">Risk & Remediation</h3><div className="mt-3 space-y-2">{data.risks.map((risk) => <div key={risk} className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{risk}</div>)}{data.remediationTasks.map((task) => <div key={task.code} className="rounded-xl bg-tcds-surface p-3"><p className="text-sm font-black">{task.label}</p><p className="text-xs font-bold text-tcds-muted">{task.status}</p></div>)}</div></ScreenCard>}

      <ScreenCard>
        <div className="flex items-center gap-2"><Clock3 className="text-tcds-gold"/><h3 className="font-display text-section font-black">Chain of Custody</h3></div>
        <div className="mt-4 space-y-4 border-l-2 border-tcds-gold/30 pl-4">{data.timeline.map((event) => <div key={event.eventId} className="relative"><span className="absolute -left-[1.36rem] top-1 h-3 w-3 rounded-full bg-tcds-gold"/><p className="font-black">{event.label}</p><p className="text-xs font-semibold text-tcds-muted">{new Date(event.occurredAt).toLocaleString()} {event.actorLabel ? `· ${event.actorLabel}` : ''}</p></div>)}</div>
      </ScreenCard>

      {actionMessage && <div className="rounded-2xl border border-tcds-line bg-white p-3 text-sm font-bold shadow-surface">{actionMessage}</div>}
      <PrimaryButton onClick={() => setActionsOpen(true)}><MoreHorizontal size={18}/>Warehouse Actions</PrimaryButton>
    </div>
    {actionsOpen && <InventoryActionSheet actions={data.actions} onAction={(action) => void runAction(action)} onClose={() => setActionsOpen(false)} />}
  </>;
}
