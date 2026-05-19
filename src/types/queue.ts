export interface BaseJobPayload {
  processRunId: number;
  processStepId?: number;
  entityType: string;
  entityPk: string;
  correlationId?: string | null;
  causationId?: string | null;
  idempotencyKey: string;
}

export interface ListingEvidenceJob extends BaseJobPayload {
  listingId?: number | null;
}

export interface ShippingEvidenceJob extends BaseJobPayload {}

export interface PricingEvidenceJob extends BaseJobPayload {}

export interface LearningFeaturesJob extends BaseJobPayload {}

export interface FinalizeRunJob extends BaseJobPayload {}
