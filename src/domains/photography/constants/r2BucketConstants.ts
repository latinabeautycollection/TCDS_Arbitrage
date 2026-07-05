export const R2_BUCKETS = {
  originals: 'tcds-photo-originals-prod',
  processed: 'tcds-photo-processed-prod',
  thumbnails: 'tcds-photo-thumbnails-prod',
  evidence: 'tcds-photo-evidence-prod',
  review: 'tcds-photo-review-prod',
  temp: 'tcds-photo-temp-prod',
  deadletter: 'tcds-photo-deadletter-prod',
  analytics: 'tcds-photo-analytics-prod',
} as const;

export const R2_STORAGE_CLASSES = {
  standard: 'STANDARD',
  infrequentAccess: 'STANDARD_IA',
} as const;

export const R2_METADATA_KEYS = [
  'candidate-id',
  'listing-id',
  'photo-set-id',
  'photo-role',
  'original-sha256',
  'processed-sha256',
  'perceptual-hash',
  'provider',
  'model-version',
  'processing-version',
  'ebay-compliance-status',
  'forensic-event-id',
] as const;

export const PUBLIC_R2_PURPOSES = new Set(['processed']);
