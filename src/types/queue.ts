export interface BaseJobPayload {
  processRunId: string | number;
  processStepId?: number;
  entityType: string;
  entityPk: string;
  correlationId?: string | null;
  causationId?: string | null;
  idempotencyKey: string;
}

export interface ListingEvidenceJob extends BaseJobPayload {
  listingId?: number | string | null;
}

export interface ShippingEvidenceJob extends BaseJobPayload {
  candidateId?: number | string | null;
  listingId?: number | string | null;
  sourceListingNormalizedId?: number | string | null;
  shippingCaptureSignalOutboxId?: number | string | null;
  signalHash?: string | null;
  payloadJson?: Record<string, unknown>;
}

export interface PricingEvidenceJob extends BaseJobPayload {}
export interface LearningFeaturesJob extends BaseJobPayload {}
export interface FinalizeRunJob extends BaseJobPayload {}
