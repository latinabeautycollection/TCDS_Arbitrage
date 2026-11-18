export type CaptureEvidence = {
  source?: "CAMERA" | "MANUAL" | "HID";
  symbology?: string;
  canonicalSymbology?: "CODE128" | "EAN13_UPCA" | "QR";
  provider?: string;
  observationId?: string;
  capturedAt?: string;
  captureDurationMs?: number;
};

export type OperationHeaders = {
  requestId: string;
  correlationId: string;
  idempotencyKey: string;
};

export type PackShipRoutePrincipal = {
  authSessionId: string;
};

export type V02TaskSnapshot = {
  packingTaskId: string;
  taskNumber: string;
  status: string;
  rowVersion: number;
  facilityId: string;
  assignedStationId?: string | null;
  fulfillmentOrderId: string;
  carrierCutoffAt?: string | null;
  claim?: {
    heldBySession?: boolean;
    employeeId?: string;
    deviceId?: string;
    expiresAt?: string;
  } | null;
  sourceVerified: boolean;
  items: Array<{
    packingTaskItemId: string;
    itemId: string;
    expectedBarcode?: string | null;
    expectedQuantity: number;
    verifiedQuantity: number;
    status: string;
    rowVersion: number;
    /** V0.2.1: product_profiles.title; null when the item has no product profile. */
    title?: string | null;
  }>;
  package?: {
    packageId: string;
    packageNumber: string;
    status: string;
    rowVersion: number;
    weightOz?: number | null;
    lengthIn?: number | null;
    widthIn?: number | null;
    heightIn?: number | null;
  } | null;
  shipment?: {
    shipmentId?: string | null;
    shippingHandoffId?: string | null;
    carrierCode?: string | null;
    status?: string | null;
    trackingPresent?: boolean;
  } | null;
  blockers: string[];
  // ---- V0.2.1 additive fields (warehouse.packship__snapshot, applied to production 2026-11-17) ----
  snapshotVersion?: string;
  facility?: { facilityCode: string | null } | null;
  station?: { stationCode: string } | null;
  order?: { externalOrderId: string | null; shipByAt: string | null } | null;
  evidence?: {
    requirementCount: number; required: number; accepted: number;
    pending: number; rejected: number; integrityVerified: boolean;
  } | null;
  stationReadiness?: {
    ready: boolean; evaluatedAt: string; ageSeconds: number;
    readinessScore: number | null; blockingFailures: number; reasons: string[];
  } | null;
  printJob?: {
    printJobId: string; jobType: string; status: string; attemptCount: number;
    completedAt: string | null; updatedAt: string;
  } | null;
};

/** The snapshot version this mapper is written against. Older snapshots are refused, never half-mapped. */
export const PACKSHIP_SNAPSHOT_VERSION = "0.2.1";

export type V02Result = {
  ok: boolean;
  code: string;
  replayed?: boolean;
  task?: V02TaskSnapshot;
  scanEventId?: number | string;
  trackingScanEventId?: number | string;
  packageScanEventId?: number | string;
  labelPairId?: string;
  scanResult?: string;
  [key: string]: unknown;
};

/** V0.2.2 (914) warehouse.packship_list_packaging_options_v2 result. */
export type V022PackagingOption = {
  profileId: string; profileCode: string; profileName: string; version: number; packagingTypeCode: string;
  itemCategoryKey: string | null; maximumWeightOz: number | null;
  minimumLengthIn: number | null; minimumWidthIn: number | null; minimumHeightIn: number | null;
};
export type V022PackagingOptionsResult = {
  ok: boolean; code: string; packingTaskId?: string; taskStatus?: string; taskRowVersion?: number; selectable?: boolean;
  eligibilityRule?: string;
  basis?: { itemCount: number; knownWeightOz: number; itemsWithoutWeight: number; categories: string[]; itemsWithoutCategory: number };
  options?: V022PackagingOption[];
  [key: string]: unknown;
};

/** GET /api/v1/packing/tasks/:taskId/packaging-options response (contract packship.packaging-options.v1). */
export type PackagingOptionsResponse = {
  contractVersion: "packship.packaging-options.v1";
  taskId: string; taskStatus: string; taskRowVersion: number;
  /** true when POST .../package would accept a choice now (status PACKING, claim held by this session, no package yet). */
  selectable: boolean;
  eligibilityRule: string;
  basis: { itemCount: number; knownWeightOz: number; itemsWithoutWeight: number; categories: string[]; itemsWithoutCategory: number };
  /** Send options[i].profileId as `profileId` to POST .../package. */
  options: V022PackagingOption[];
};
