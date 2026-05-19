import {
  ListingEvidenceJob,
  ShippingEvidenceJob,
  PricingEvidenceJob,
  LearningFeaturesJob,
  FinalizeRunJob
} from '../types/queue';

export interface QueueContractMap {
  'forensic.capture.listing': ListingEvidenceJob;
  'forensic.capture.shipping': ShippingEvidenceJob;
  'forensic.capture.pricing': PricingEvidenceJob;
  'forensic.compute.learning': LearningFeaturesJob;
  'forensic.finalize.run': FinalizeRunJob;
}
