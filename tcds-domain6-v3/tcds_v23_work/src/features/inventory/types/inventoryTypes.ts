export type EffectiveInventoryStatus =
  | 'CRITICAL_SAFETY_HOLD'
  | 'QUARANTINE'
  | 'MISSING'
  | 'INTEGRITY_EXCEPTION'
  | 'MANUAL_ADMISSION'
  | 'HOLD'
  | 'PICKING'
  | 'PICKED'
  | 'PACKING'
  | 'RESERVED'
  | 'AVAILABLE'
  | 'SHIPPED'
  | 'ARCHIVED';

export type AdmissionProvenance =
  | 'STANDARD_RECEIVING'
  | 'MANUAL_MANAGER_ADMISSION'
  | 'RETURN_RECOVERY'
  | 'MIGRATION'
  | 'TRANSFER'
  | 'SYSTEM_RECOVERY';

export type InventoryFilter =
  | 'ALL'
  | 'AVAILABLE'
  | 'RESERVED'
  | 'PICKING'
  | 'PACKING'
  | 'HOLD'
  | 'QUARANTINE'
  | 'MISSING'
  | 'PROVISIONAL'
  | 'MANUAL_ADMISSION'
  | 'DISCREPANCY'
  | 'STALE_LOCATION'
  | 'EVIDENCE_ISSUE'
  | 'CROSS_FACILITY'
  | 'ARCHIVED';

export type InventorySummaryMetric = {
  key: string;
  label: string;
  value: number;
  severity?: 'NORMAL' | 'WARNING' | 'CRITICAL';
};

export type InventoryListItem = {
  itemId: string;
  internalBarcode: string;
  title: string;
  brand?: string;
  model?: string;
  variant?: string;
  serialSuffix?: string;
  primaryPhotoUrl?: string;
  locationCode?: string;
  effectiveStatus: EffectiveInventoryStatus;
  condition: string;
  provenance: AdmissionProvenance;
  holdLabel?: string;
  openInvestigationCount: number;
  digitalTwinHealth: number;
  lastPhysicalConfirmationAt?: string;
  locationFreshnessState: 'CURRENT' | 'STALE' | 'UNKNOWN';
  rowVersion: number;
  updatedAt: string;
  flags: string[];
};

export type InventoryListResponse = {
  facility: { facilityCode: string; facilityName: string };
  station: { stationCode: string; stationName: string };
  freshness: { generatedAt: string; source: 'LIVE' | 'CACHE'; queuedObservations: number };
  metrics: InventorySummaryMetric[];
  items: InventoryListItem[];
  nextCursor?: string;
  searchDegraded: boolean;
};

export type InventoryEvidence = {
  evidenceId: string;
  label: string;
  status: 'VERIFIED' | 'WARNING' | 'MISSING';
  hashIntegrity: 'VERIFIED' | 'FAILED' | 'UNKNOWN';
  thumbnailUrl?: string;
};

export type InventoryTimelineEvent = {
  eventId: string;
  eventType: string;
  label: string;
  occurredAt: string;
  actorLabel?: string;
  locationCode?: string;
  outcome?: string;
};

export type InventoryAction = {
  actionCode:
    | 'MOVE_ITEM'
    | 'REPRINT_BARCODE'
    | 'ADD_EVIDENCE'
    | 'PLACE_HOLD'
    | 'RELEASE_HOLD'
    | 'START_CYCLE_COUNT'
    | 'REPORT_MISSING'
    | 'REPORT_WRONG_LOCATION'
    | 'REQUEST_IDENTITY_CORRECTION';
  label: string;
  enabled: boolean;
  disabledReason?: string;
  requiresApproval?: boolean;
};

export type InventoryDetailResponse = {
  item: InventoryListItem & {
    identifiers: Array<{ type: string; valueMasked: string; verified: boolean }>;
    quantity: number;
    verificationConfidence?: number;
    barcodeStatus: string;
  };
  position: {
    facilityCode: string;
    zoneCode?: string;
    aisleCode?: string;
    shelfCode?: string;
    binCode?: string;
    locationHealth: string;
    capacityImpact?: string;
    lastConfirmedAt?: string;
    discrepancyState?: string;
  };
  upstream: {
    receiptId?: string;
    receivingSessionId?: string;
    photoSessionId?: string;
    verificationSessionId?: string;
    putawaySessionId?: string;
    manualAdmissionId?: string;
  };
  evidence: InventoryEvidence[];
  timeline: InventoryTimelineEvent[];
  actions: InventoryAction[];
  risks: string[];
  remediationTasks: Array<{ code: string; label: string; status: string }>;
};

export type ManualAdmissionReason =
  | 'LEGACY_INVENTORY_MIGRATION'
  | 'FOUND_UNRECORDED_ITEM'
  | 'DISASTER_RECOVERY'
  | 'SYSTEM_OUTAGE_RECOVERY'
  | 'PHYSICAL_COUNT_DISCOVERY'
  | 'RETURN_WITHOUT_SOURCE_RECORD'
  | 'INTER_FACILITY_TRANSFER_RECOVERY'
  | 'DONATION_OR_COMPANY_ASSET'
  | 'DATA_CORRECTION'
  | 'OTHER_MANAGER_APPROVED';

export type ManualAdmissionDraft = {
  reasonCode: ManualAdmissionReason;
  justification: string;
  discoveryLocation: string;
  title: string;
  brand: string;
  model: string;
  quantity: number;
  condition: string;
  ownershipClassification: string;
  provenanceNotes?: string;
  identifiers: Array<{ type: string; value: string }>;
  evidenceAssetIds: string[];
  foundByEmployeeNumber: string;
};

export type ScanResolution = {
  resolutionType: 'ITEM' | 'LOCATION' | 'PACKAGE' | 'ORDER' | 'UNKNOWN' | 'AMBIGUOUS' | 'INTEGRITY_ALERT';
  itemId?: string;
  locationCode?: string;
  matches?: InventoryListItem[];
  message?: string;
};
