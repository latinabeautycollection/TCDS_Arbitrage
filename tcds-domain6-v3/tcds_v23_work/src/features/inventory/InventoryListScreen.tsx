import { useState } from 'react';
import { AlertTriangle, Plus, RefreshCw, ScanLine, Search, ShieldAlert, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';
import { ScreenCard } from '../../components/ScreenCard';
import { useInventory } from './hooks/useInventory';
import { resolveInventoryScan } from './services/inventoryApi';
import { InventoryItemCard } from './components/InventoryItemCard';
import { ManualAdmissionSheet } from './components/ManualAdmissionSheet';
import type { InventoryFilter } from './types/inventoryTypes';

const filters: Array<{ key: InventoryFilter; label: string }> = [
  { key: 'ALL', label: 'All' }, { key: 'AVAILABLE', label: 'Available' }, { key: 'RESERVED', label: 'Reserved' },
  { key: 'HOLD', label: 'Hold' }, { key: 'QUARANTINE', label: 'Quarantine' }, { key: 'MISSING', label: 'Missing' },
  { key: 'PROVISIONAL', label: 'Provisional' }, { key: 'MANUAL_ADMISSION', label: 'Manual Admission' },
  { key: 'DISCREPANCY', label: 'Discrepancy' }, { key: 'STALE_LOCATION', label: 'Stale Location' },
  { key: 'EVIDENCE_ISSUE', label: 'Evidence Issue' }, { key: 'ARCHIVED', label: 'Archived' },
];

export function InventoryListScreen() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<InventoryFilter>('ALL');
  const [scanValue, setScanValue] = useState('');
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [manualAdmissionOpen, setManualAdmissionOpen] = useState(false);
  const { data, loading, refreshing, error, refresh } = useInventory(query, filter);

  async function resolveScan() {
    if (!scanValue.trim()) return;
    try {
      const resolution = await resolveInventoryScan(scanValue.trim());
      if (resolution.resolutionType === 'ITEM' && resolution.itemId) navigate(`/inventory/detail?item=${encodeURIComponent(resolution.itemId)}`);
      else if (resolution.resolutionType === 'LOCATION' && resolution.locationCode) { setQuery(resolution.locationCode); setScanMessage(`Showing inventory at ${resolution.locationCode}`); }
      else setScanMessage(resolution.message ?? `${resolution.resolutionType.replaceAll('_',' ')} — review required.`);
    } catch (caught) { setScanMessage(caught instanceof Error ? caught.message : 'Scan could not be resolved.'); }
  }

  return <>
    <AppHeader title="Inventory" subtitle="Authoritative facility inventory and Digital Twin control" />
    <div className="mx-auto max-w-md space-y-4 p-4">
      {!navigator.onLine && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900"><div className="flex gap-2"><WifiOff size={18}/><p>Offline: showing cached data only. All authoritative inventory actions are blocked.</p></div></div>}
      <ScreenCard>
        <div className="flex items-start justify-between gap-3"><div><p className="text-caption font-black uppercase tracking-[0.22em] text-tcds-gold">Inventory Command Center</p><h2 className="mt-1 font-display text-section font-black">{data?.facility.facilityCode ?? 'Facility inventory'}</h2><p className="mt-1 text-sm font-semibold text-tcds-muted">{data ? `${data.metrics.find((m) => m.key === 'TOTAL_ACTIVE')?.value ?? data.items.length} active items` : 'Loading authoritative inventory…'}</p></div><button onClick={refresh} disabled={refreshing} className="rounded-2xl border border-tcds-line bg-white p-3 shadow-surface" aria-label="Refresh inventory"><RefreshCw size={18} className={refreshing ? 'animate-spin' : ''}/></button></div>
        {data && <div className="mt-4 grid grid-cols-3 gap-2">{data.metrics.slice(0, 6).map((metric) => <div key={metric.key} className="rounded-2xl bg-tcds-surface p-3"><p className="font-display text-xl font-black">{metric.value}</p><p className="mt-1 text-[10px] font-black uppercase tracking-wide text-tcds-muted">{metric.label}</p></div>)}</div>}
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl border border-tcds-line p-2.5"><p className="font-bold text-tcds-muted">Station</p><p className="font-black">{data?.station.stationCode ?? '—'}</p></div><div className="rounded-xl border border-tcds-line p-2.5"><p className="font-bold text-tcds-muted">Data freshness</p><p className="font-black">{data ? new Date(data.freshness.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</p></div></div>
      </ScreenCard>

      <ScreenCard>
        <div className="flex items-center gap-2"><ScanLine className="text-tcds-gold"/><h2 className="font-display text-section font-black">Scan-first lookup</h2></div>
        <div className="mt-3 flex gap-2"><input value={scanValue} onChange={(e) => setScanValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void resolveScan(); }} className="min-h-14 min-w-0 flex-1 rounded-2xl border border-tcds-line px-4 text-base" placeholder="Item, serial, location, package…"/><button onClick={() => void resolveScan()} className="min-h-14 rounded-2xl bg-tcds-black px-4 font-black text-white">Resolve</button></div>
        {scanMessage && <p className="mt-3 rounded-xl bg-tcds-surface p-3 text-sm font-bold">{scanMessage}</p>}
        <div className="relative mt-4"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-tcds-muted" size={18}/><input value={query} onChange={(e) => setQuery(e.target.value)} className="min-h-14 w-full rounded-2xl border border-tcds-line pl-11 pr-4 text-base" placeholder="Search title, brand, model, serial, bin, order"/></div>
      </ScreenCard>

      <div className="flex gap-2 overflow-x-auto pb-1">{filters.map((entry) => <button key={entry.key} onClick={() => setFilter(entry.key)} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-black ${filter === entry.key ? 'border-tcds-black bg-tcds-black text-tcds-gold' : 'border-tcds-line bg-white text-tcds-muted'}`}>{entry.label}</button>)}</div>

      <button onClick={() => setManualAdmissionOpen(true)} className="tcds-focus enterprise-motion flex min-h-14 w-full items-center justify-center gap-2 rounded-enterprise border border-tcds-gold bg-tcds-gold/10 px-4 font-black text-tcds-goldDeep"><Plus size={18}/>Manager Manual Inventory Admission</button>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800"><div className="flex gap-2"><ShieldAlert size={18}/><div><p className="font-black">Inventory service unavailable</p><p className="mt-1 text-sm font-semibold">{error}</p></div></div></div>}
      {loading && !data && <div className="space-y-3">{[1,2,3].map((n) => <div key={n} className="skeleton h-48 rounded-enterprise" />)}</div>}
      {data?.searchDegraded && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900"><div className="flex gap-2"><AlertTriangle size={18}/><p>Ranked search is degraded. Exact barcode and serial resolution remain available.</p></div></div>}
      {data && data.items.length === 0 && <div className="rounded-enterprise border border-dashed border-tcds-line bg-white p-8 text-center"><p className="font-display text-section font-black">No matching inventory</p><p className="mt-2 text-sm text-tcds-muted">Adjust filters, scan another barcode, or report an unknown item through the controlled manager workflow.</p></div>}
      <div className="space-y-3">{data?.items.map((item) => <InventoryItemCard key={item.itemId} item={item} onOpen={() => navigate(`/inventory/detail?item=${encodeURIComponent(item.itemId)}`)} />)}</div>
    </div>
    <ManualAdmissionSheet open={manualAdmissionOpen} onClose={() => setManualAdmissionOpen(false)} onCreated={(itemId) => navigate(`/inventory/detail?item=${encodeURIComponent(itemId)}`)} />
  </>;
}
