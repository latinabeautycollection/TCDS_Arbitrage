import type { EffectiveInventoryStatus } from '../types/inventoryTypes';

const labels: Record<EffectiveInventoryStatus, string> = {
  CRITICAL_SAFETY_HOLD: 'Safety Hold',
  QUARANTINE: 'Quarantine',
  MISSING: 'Missing',
  INTEGRITY_EXCEPTION: 'Integrity Exception',
  MANUAL_ADMISSION: 'Manual Admission',
  HOLD: 'Hold',
  PICKING: 'Picking',
  PICKED: 'Picked',
  PACKING: 'Packing',
  RESERVED: 'Reserved',
  AVAILABLE: 'Available',
  SHIPPED: 'Shipped',
  ARCHIVED: 'Archived',
};

export function InventoryStatusBadge({ status }: { status: EffectiveInventoryStatus }) {
  const danger = ['CRITICAL_SAFETY_HOLD', 'MISSING', 'INTEGRITY_EXCEPTION'].includes(status);
  const warning = ['QUARANTINE', 'MANUAL_ADMISSION', 'HOLD'].includes(status);
  const success = status === 'AVAILABLE';
  const className = danger
    ? 'border-red-200 bg-red-50 text-red-700'
    : warning
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : success
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-tcds-line bg-tcds-surface text-tcds-ink';
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${className}`}>{labels[status]}</span>;
}
