import type { PackShipTask } from '../types/packShipTypes';
import type { PackShipMeasurementInput } from '../services/packShipApi';

/**
 * What the four Pack/Ship controls (Claim, Select Box, Measurements, Seal) may offer for a task snapshot.
 * Presentation only: every action is still authorized by the database (claim, status, row versions, eligibility,
 * supervisor approval). These rules mirror the V0.2 functions so the screen never offers a write the database
 * is certain to refuse.
 */

export type ClaimView =
  | { kind: 'UNCLAIMED' }                       // nobody holds it: Claim
  | { kind: 'HELD'; expiresAt: string | null }  // this session holds it
  | { kind: 'HELD_BY_OTHER'; expiresAt: string | null }
  | { kind: 'EXPIRED' }                         // a lapsed claim: Claim takes it over
  | { kind: 'NOT_CLAIMABLE' };                  // finished or terminal status

/** packship_claim_task_v2 accepts these statuses. */
const CLAIMABLE = new Set(['READY', 'CLAIMED', 'CONTENTS_VERIFYING', 'PACKING', 'MEASURING', 'EVIDENCE_PENDING', 'PACKED',
  'SHIPPING_REVIEW', 'LABEL_PENDING', 'LABEL_PURCHASED', 'PRINTING', 'LABEL_VERIFIED']);

export function claimView(task: PackShipTask): ClaimView {
  if (!task.taskStatus || !CLAIMABLE.has(task.taskStatus)) return { kind: 'NOT_CLAIMABLE' };
  const c = task.claim;
  if (!c) return { kind: 'UNCLAIMED' };
  if (c.expired) return { kind: 'EXPIRED' };
  return c.heldBySession ? { kind: 'HELD', expiresAt: c.expiresAt } : { kind: 'HELD_BY_OTHER', expiresAt: c.expiresAt };
}

export const holdsClaim = (task: PackShipTask) => claimView(task).kind === 'HELD';

/** packship_select_package_v2: status PACKING, claim held, no package yet (the options endpoint confirms it). */
export const canChooseBox = (task: PackShipTask) => task.taskStatus === 'PACKING' && holdsClaim(task) && !task.packageId;

/** packship_record_measurements_v2: MEASURING or EVIDENCE_PENDING, claim held, the current package identity known. */
export const canMeasure = (task: PackShipTask) =>
  (task.taskStatus === 'MEASURING' || task.taskStatus === 'EVIDENCE_PENDING') && holdsClaim(task)
  && !!task.packageId && Number.isSafeInteger(task.packageRowVersion) && !task.sealed;

/**
 * packship_complete_task_v2: EVIDENCE_PENDING, claim held, current package, no blockers. The blocking gates for the
 * steps before the seal (contents, measurements, evidence) must all PASS.
 */
export function canSeal(task: PackShipTask): boolean {
  if (task.taskStatus !== 'EVIDENCE_PENDING' || !holdsClaim(task) || task.sealed) return false;
  if (!task.packageId || !Number.isSafeInteger(task.packageRowVersion)) return false;
  const before = task.completionGates.filter((g) => g.blocking && ['CONTENTS', 'MEASUREMENTS', 'EVIDENCE'].includes(g.code));
  return before.length === 3 && before.every((g) => g.state === 'PASS');
}

export type MeasurementDraft = { pounds: string; ounces: string; lengthIn: string; widthIn: string; heightIn: string };
export type MeasurementCheck =
  | { ok: true; value: PackShipMeasurementInput }
  | { ok: false; field: 'weight' | 'length' | 'width' | 'height' };

const num = (s: string) => (/^\d+(\.\d+)?$/.test(s.trim()) ? Number(s.trim()) : NaN);

/** Same limits as packship_record_measurements_v2: weight > 0 and <= 2400 oz, each dimension > 0 and <= 240 in. */
export function checkMeasurements(d: MeasurementDraft): MeasurementCheck {
  const lb = d.pounds.trim() === '' ? 0 : num(d.pounds);
  const oz = d.ounces.trim() === '' ? 0 : num(d.ounces);
  if (!Number.isFinite(lb) || !Number.isFinite(oz) || oz >= 16 && lb > 0) return { ok: false, field: 'weight' };
  const weightOz = Math.round((lb * 16 + oz) * 1000) / 1000;
  if (!(weightOz > 0 && weightOz <= 2400)) return { ok: false, field: 'weight' };
  const dims = { lengthIn: num(d.lengthIn), widthIn: num(d.widthIn), heightIn: num(d.heightIn) };
  for (const [k, field] of [['lengthIn', 'length'], ['widthIn', 'width'], ['heightIn', 'height']] as const) {
    const v = dims[k];
    if (!(Number.isFinite(v) && v > 0 && v <= 240)) return { ok: false, field };
  }
  return { ok: true, value: { weightOz, ...dims } };
}
