import type { PackShipMessage } from './packShipMessages';
export type ReadinessState = 'READY' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
export type GateState = 'PASS' | 'FAIL' | 'PENDING' | 'NOT_APPLICABLE';
export type PackingStage =
  | 'CONTENTS'
  | 'PACKAGING'
  | 'ITEM_LABEL'
  | 'MEASUREMENTS'
  | 'EVIDENCE'
  | 'SEALED'
  | 'ADDRESS'
  | 'RISK'
  | 'RATES'
  | 'CARRIER_LABEL'
  | 'LABEL_VERIFY'
  | 'OUTBOUND';

export type PackShipReadiness = {
  api: ReadinessState;
  postgres: ReadinessState;
  scanner: ReadinessState;
  scale: ReadinessState;
  printer: ReadinessState;
  gateway: ReadinessState;
  network: ReadinessState;
};

export type PackItem = {
  itemId: string;
  internalBarcode: string;
  title: string;
  serialEnding?: string;
  quantity: number;
  verified: boolean;
};

export type PackagingRecommendation = {
  profileId: string;
  packageCode: string;
  description: string;
  protection: string[];
  confidence: number;
  dimensionalWeightRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  modelVersion: string;
};

export type PackageMeasurement = {
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
  weightLb?: number;
  source: 'MEASURED' | 'MANUAL_FALLBACK' | 'ESTIMATED' | 'PENDING';
  stable: boolean;
};

export type EvidenceProgress = {
  required: number;
  accepted: number;
  pending: number;
  rejected: number;
  integrityVerified: boolean;
};

export type AddressValidation = {
  status: 'NOT_STARTED' | 'VALIDATED' | 'VALIDATED_WITH_CORRECTION' | 'AMBIGUOUS' | 'UNDELIVERABLE' | 'REVIEW_REQUIRED';
  entered?: string;
  normalized?: string;
  correctionAccepted?: boolean;
};

export type ShippingProtection = {
  declaredValue: number;
  insuranceRequired: boolean;
  deliveryConfirmationRequired: boolean;
  signatureRequired: boolean;
  restrictedDeliveryRequired: boolean;
  routing: 'AUTO_APPROVE' | 'AI_REVIEW' | 'MANAGER_REVIEW' | 'EXECUTIVE_HOLD' | 'PENDING';
  riskScore?: number;
  reasons: string[];
};

export type RateOption = {
  quoteId: string;
  carrier: string;
  service: string;
  totalCost: number;
  currency: string;
  estimatedDelivery: string;
  onTimeConfidence: number;
  lossRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  insuranceIncluded: boolean;
  signature: string;
  profitImpact: number;
  recommended: boolean;
  approvalRequired: boolean;
};

export type CarrierLabelState = {
  status: 'NOT_PURCHASED' | 'PURCHASE_PENDING' | 'LABEL_PURCHASED' | 'PRINT_QUEUED' | 'PRINTING' | 'PRINTED' | 'APPLIED' | 'SCAN_VERIFIED' | 'VOIDED' | 'UNCERTAIN';
  trackingNumber?: string;
  carrier?: string;
  packageBarcode?: string;
  printJobId?: string;
};

export type CompletionGate = {
  code: string;
  label: string;
  state: GateState;
  blocking: boolean;
  detail?: string;
  stage?: 'CONTENTS' | 'PACKAGING' | 'MEASUREMENTS' | 'EVIDENCE' | 'ADDRESS' | 'RATES' | 'LABEL' | 'OUTBOUND';
};

export type PackShipTask = {
  taskId: string;
  taskNumber: string;
  orderId: string;
  orderNumber: string;
  shipmentId?: string;
  facilityCode: string;
  stationCode: string;
  employeeName: string;
  claimExpiresAt: string;
  carrierCutoffAt?: string;
  rowVersion: number;
  stage: PackingStage;
  sourceBarcode: string;
  sourceVerified: boolean;
  items: PackItem[];
  packageBarcode?: string;
  packaging?: PackagingRecommendation;
  itemLabelStatus: 'ACTIVE_PENDING_PRINT' | 'PRINT_QUEUED' | 'PRINTED' | 'APPLIED' | 'VERIFIED';
  measurement: PackageMeasurement;
  evidence: EvidenceProgress;
  sealed: boolean;
  address: AddressValidation;
  protection: ShippingProtection;
  rates: RateOption[];
  selectedQuoteId?: string;
  carrierLabel: CarrierLabelState;
  outboundLocation?: string;
  readiness: PackShipReadiness;
  completionGates: CompletionGate[];
  localPendingCount: number;
  lastUpdatedAt: string;
  operationalMessages?: PackShipMessage[];
};
