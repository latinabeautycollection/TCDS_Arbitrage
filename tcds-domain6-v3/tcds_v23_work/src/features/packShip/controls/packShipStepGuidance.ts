import type { PackShipTask } from '../types/packShipTypes';

/**
 * Step guidance (what to do now, and what comes next) for the Pack & Ship cards, from the task's current state.
 * Presentation only. Fixed text went stale: the label card said "Next: Scan the approved outbound staging location"
 * before a label was even bought.
 */
export type StepGuidance = { what: string; next: string };

type LabelStatus = PackShipTask['carrierLabel']['status'];

/** A purchased label that is not yet linked to the package: the tracking + package pair can be scanned. */
export const PAIRABLE_LABEL_STATUSES: ReadonlySet<LabelStatus> = new Set<LabelStatus>([
  'LABEL_PURCHASED', 'PRINT_QUEUED', 'PRINTING', 'PRINTED', 'APPLIED',
]);

const SCAN_PAIR = 'Apply it to the package, then scan the tracking and package barcodes.';

export function labelStepGuidance(status: LabelStatus): StepGuidance {
  switch (status) {
    case 'NOT_PURCHASED': return { what: 'The carrier label has not been purchased yet.', next: 'Purchase the label under Shipping Authorization, then print it.' };
    case 'PURCHASE_PENDING': return { what: 'The carrier label purchase is in progress.', next: 'Wait for it to finish, then print the label.' };
    case 'UNCERTAIN': return { what: 'The label purchase is not confirmed yet.', next: 'Refresh the task. Do not purchase a second label.' };
    case 'VOIDED': return { what: 'This carrier label was voided.', next: 'A new label must be purchased before the package can ship.' };
    case 'LABEL_PURCHASED': return { what: 'Print the purchased carrier label.', next: SCAN_PAIR };
    case 'PRINT_QUEUED':
    case 'PRINTING': return { what: 'The carrier label is printing.', next: SCAN_PAIR };
    case 'PRINTED':
    case 'APPLIED': return { what: 'Apply the printed label, then scan both barcodes.', next: 'Verify the package ↔ tracking link.' };
    case 'SCAN_VERIFIED': return { what: 'The package and tracking are linked.', next: 'Scan the approved outbound staging location.' };
    default: return { what: 'Print and apply the carrier label, then scan both barcodes.', next: 'Verify the package ↔ tracking link.' };
  }
}

export function contentsStepGuidance(sourceVerified: boolean, contentsVerified: boolean): StepGuidance {
  if (contentsVerified) return { what: 'The source and every item are verified.', next: 'Choose the box below.' };
  if (sourceVerified) return { what: 'Scan each exact TCDS item barcode.', next: 'Confirm every expected item.' };
  return { what: 'Scan the tote or packing-stage barcode.', next: 'Scan the first expected item.' };
}
