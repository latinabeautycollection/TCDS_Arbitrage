import { Camera, CheckCircle2, ClipboardCheck, MapPin, PackageSearch, Printer, ScanLine, ShieldCheck, Truck } from 'lucide-react';
import { ActionSheetPreview } from '../components/ActionSheetPreview';
import { AppHeader } from '../components/AppHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenCard } from '../components/ScreenCard';
import { EmptyState, ErrorState, LoadingSkeleton, OfflineState, SuccessToastPreview } from '../components/StateBlocks';

type ShellProps = {
  title: string;
  subtitle: string;
  primary: string;
  bullets: string[];
  visual?: 'storage' | 'inventory' | 'pick' | 'shipping' | 'returns' | 'settings';
  secondaryPattern?: JSX.Element;
};

export function Receive() {
  return <><AppHeader title="Receive Item" subtitle="Scan PropertyRoom, purchase, or internal barcode" />
    <div className="mx-auto max-w-md space-y-4 p-4">
      <ScreenCard>
        <div className="relative overflow-hidden rounded-[2rem] border-2 border-dashed border-tcds-gold bg-white p-10 text-center shadow-inner">
          <div className="absolute left-8 right-8 top-1/2 h-1 -translate-y-1/2 rounded-full bg-tcds-gold/60 scan-pulse" />
          <ScanLine className="relative mx-auto mb-4 text-tcds-black" size={56} />
          <p className="relative font-display text-2xl font-black tracking-tight text-tcds-ink">READY TO SCAN</p>
          <p className="relative mt-2 text-sm font-semibold text-tcds-muted">Waiting for PropertyRoom barcode…</p>
        </div>
        <button className="tcds-focus enterprise-motion mt-4 min-h-14 w-full rounded-2xl border border-tcds-line bg-tcds-surface px-4 py-4 font-black text-tcds-ink shadow-soft">Enter Manually</button>
      </ScreenCard>
      <ScreenCard>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-tcds-surface p-3"><p className="font-semibold text-tcds-muted">Last Sync</p><p className="font-black text-tcds-ink">10:42 AM</p></div>
          <div className="rounded-2xl bg-tcds-surface p-3"><p className="font-semibold text-tcds-muted">Offline Queue</p><p className="font-black text-tcds-green">0 Pending</p></div>
        </div>
      </ScreenCard>
      <OfflineState />
    </div></>;
}

export function Photos() {
  const photos = ['Front', 'Rear', 'Serial Number', 'Accessories', 'Damage', 'Auction Label'];
  return <><AppHeader title="Capture Photos" subtitle="Required evidence before inventory acceptance" />
    <div className="mx-auto max-w-md space-y-4 p-4">
      <ScreenCard>
        <div className="mb-4 rounded-2xl border border-tcds-gold/30 bg-tcds-gold/10 p-3 text-sm font-black text-tcds-goldDeep">Auto-advance to Verify Item after all six required photos are captured.</div>
        <div className="grid grid-cols-2 gap-3">
          {photos.map((p, i) => <div key={p} className="enterprise-motion rounded-2xl border border-tcds-line bg-white p-3 shadow-soft">
            <div className="mb-3 grid h-24 place-items-center rounded-xl bg-tcds-surface"><Camera className="text-tcds-gold" /></div>
            <p className="font-black text-tcds-ink">{i < 2 ? '✓' : '○'} {p}</p><p className="text-xs font-black text-tcds-green">Required</p>
          </div>)}
        </div>
      </ScreenCard>
      <SuccessToastPreview message="Preview: Evidence complete → auto-advance" />
    </div></>;
}

export function Verify() {
  return <Shell title="Verify Item" subtitle="Confirm auto-populated item details" primary="Confirm Item" bullets={['Read-only identity and source fields', 'Editable condition, missing accessories, and notes only', 'No acquisition cost or marketplace pricing shown', 'Confirm creates verification audit event', 'Exception creates supervisor task']} visual="inventory" secondaryPattern={<ErrorState title="Verification exception" message="If title, serial, or condition does not match evidence, route to exception queue instead of forcing completion." />} />;
}

export function Storage() {
  return <Shell title="Assign Storage" subtitle="Select warehouse zone and bin" primary="Assign Bin" bullets={['A01 Electronics', 'A02 Automotive', 'A03 Garden', 'A04 Musical', 'A05 General', 'A06 Overflow', 'Show available spaces, not percentages']} visual="storage" secondaryPattern={<SuccessToastPreview message="Item received → inventory created → return to Dashboard" />} />;
}

export function Inventory() {
  return <Shell title="Inventory List" subtitle="Search, scan, filter, locate" primary="Scan Inventory" bullets={['Filter chips: All, Available, Reserved, Picked, Returns, Hold', 'No pricing or marketplace decisions', 'Photo + item ID + location + status badge', 'Search by item ID, serial, bin, order', 'Scan-first lookup']} visual="inventory" secondaryPattern={<EmptyState title="No matching inventory" message="Adjust filter or scan another barcode. Empty state must not look like an error." />} />;
}

export function InventoryDetail() {
  return <Shell title="Inventory Detail" subtitle="Warehouse-only item record" primary="Queue for Listing" bullets={['Expandable sections: Item, Photos, Location, History, Actions', 'Move item uses bottom sheet, not a new page', 'Print barcode available here', 'Place hold available here', 'Queue Domain 4 without showing listing/pricing logic']} visual="inventory" secondaryPattern={<ActionSheetPreview title="Move Item" actions={['Scan new bin', 'Confirm new location', 'Create movement audit event']} />} />;
}

export function Pick() {
  return <Shell title="Pick in Progress" subtitle="Current item and next item only" primary="Scan Current Item" bullets={['Show current item only', 'Show next item only', 'Scan item barcode', 'Validate current bin', 'Move item to pack queue']} visual="pick" secondaryPattern={<SuccessToastPreview message="Pick confirmed → sent to Pack & Ship" />} />;
}

export function PackShip() {
  return <Shell title="Pack & Ship" subtitle="Weight, dimensions, rate, label" primary="Buy Label & Mark Shipped" bullets={['Package dimensions', 'Scale weight', 'Selected carrier only after service choice', 'Print label', 'Record tracking', 'Online required']} visual="shipping" secondaryPattern={<ErrorState title="Online required" message="Label purchase and carrier calls are blocked in offline mode. Save draft package data and retry when online." />} />;
}

export function Returns() {
  return <Shell title="Returns" subtitle="Inspect and disposition returned items" primary="Start Return" bullets={['Scan return', 'Inspect condition', 'Quarantine if needed', 'Restock', 'Claim', 'Dispose']} visual="returns" secondaryPattern={<ActionSheetPreview title="Disposition" actions={['Restock to original bin', 'Move to quarantine', 'Create claim packet']} />} />;
}

export function Settings() {
  return <Shell title="Settings & Exceptions" subtitle="Supervisor/admin tools" primary="Review Exceptions" bullets={['Printer status', 'Scanner status', 'Offline sync', 'Device registration', 'Exception queue', 'Admin-only actions']} visual="settings" secondaryPattern={<LoadingSkeleton label="Checking warehouse services…" />} />;
}

function Shell({ title, subtitle, primary, bullets, visual, secondaryPattern }: ShellProps) {
  return <><AppHeader title={title} subtitle={subtitle} />
    <div className="mx-auto max-w-md space-y-4 p-4">
      <ScreenCard>
        <div className="mb-4 overflow-hidden rounded-[1.6rem] border border-tcds-line bg-tcds-black text-white shadow-soft">
          <div className="border-b border-white/10 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-tcds-gold">Approved Shell Screen</p>
            <h2 className="mt-1 font-display text-2xl font-black tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-white/60">Shell is motion-ready; business logic is intentionally deferred.</p>
          </div>
          <ShellVisual visual={visual} />
        </div>
        <PrimaryButton>{primary}</PrimaryButton>
      </ScreenCard>
      <ScreenCard>
        <h3 className="mb-3 font-display font-black text-tcds-ink">Approved Shell Responsibilities</h3>
        <ul className="space-y-2 text-sm text-tcds-ink">
          {bullets.map((b) => <li key={b} className="flex items-center gap-2 rounded-xl bg-tcds-surface px-3 py-2 font-semibold"><CheckCircle2 size={16} className="text-tcds-green" /> {b}</li>)}
        </ul>
      </ScreenCard>
      {secondaryPattern}
    </div></>;
}

function ShellVisual({ visual }: { visual?: ShellProps['visual'] }) {
  if (visual === 'storage') {
    return <div className="space-y-2 p-4">{['A01-S02-B04 · 12 Available', 'A01-S02-B05 · 8 Available', 'A06-S01-B01 · Overflow'].map((x, i) => <div key={x} className="flex items-center justify-between rounded-2xl bg-white/8 p-3"><span>{x}</span><MapPin size={16} className={i === 0 ? 'text-tcds-gold' : 'text-white/40'} /></div>)}</div>;
  }
  if (visual === 'pick') {
    return <div className="space-y-3 p-4"><MiniRow label="Current Item" value="INV-2026-000184" /><MiniRow label="Location" value="A01-S02-B04" /><MiniRow label="Next" value="INV-2026-000185" /></div>;
  }
  if (visual === 'shipping') {
    return <div className="space-y-3 p-4"><MiniRow label="Weight" value="3 lb 8 oz" /><MiniRow label="Service" value="USPS Priority · $8.45" /><div className="flex items-center gap-2 rounded-2xl bg-white/8 p-3"><Truck className="text-tcds-gold" size={18} /><span>Label-ready workflow</span></div></div>;
  }
  if (visual === 'returns') {
    return <div className="space-y-3 p-4"><MiniRow label="Return" value="Scan/Search" /><MiniRow label="Inspection" value="Required" /><MiniRow label="Disposition" value="Restock / Quarantine / Claim" /></div>;
  }
  if (visual === 'settings') {
    return <div className="space-y-3 p-4"><MiniRow label="Exceptions" value="1 Open" /><MiniRow label="Printer" value="Connected" /><MiniRow label="Sync" value="Healthy" /></div>;
  }
  return <div className="grid place-items-center p-8"><PackageSearch className="text-tcds-gold" size={56} /></div>;
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-2xl bg-white/8 p-3"><span className="text-white/60">{label}</span><span className="font-black text-white">{value}</span></div>;
}
