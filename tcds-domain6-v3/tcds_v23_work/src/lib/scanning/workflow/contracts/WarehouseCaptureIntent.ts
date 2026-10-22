import type { WarehouseSymbology } from "../../capture/WarehouseSymbology";

export type WarehouseCaptureIntentType =
  | "PACKAGE_ID"
  | "ITEM_ID"
  | "LOCATION_ID"
  | "SERIAL"
  | "IMEI"
  | "MAC_ADDRESS"
  | "TRACKING_NUMBER"
  | "TOTE_ID";

export interface WarehouseCaptureIntent {
  intent: WarehouseCaptureIntentType;
  mode: "SINGLE";
  allowedSymbologies: readonly WarehouseSymbology[];
  allowManualFallback: boolean;
}

/**
 * Milestone-2 invariant:
 * all executable 6.2D policies must be a subset of the currently certified
 * 6.2B symbologies.
 */
export const DOMAIN6_2D_CERTIFIED_SYMBOLOGIES: readonly WarehouseSymbology[] =
  ["CODE128", "EAN13_UPCA", "QR"] as const;
