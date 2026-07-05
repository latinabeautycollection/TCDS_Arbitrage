import { unsupportedR2Features } from '../config/r2OptimizationConfig';

export type UnsupportedR2Feature = typeof unsupportedR2Features[number];

export class R2UnsupportedFeatureError extends Error {
  constructor(public readonly feature: UnsupportedR2Feature, public readonly mitigation: string) {
    super(`Unsupported R2/S3 feature requested: ${feature}. ${mitigation}`);
    this.name = 'R2UnsupportedFeatureError';
  }
}

const mitigations: Record<UnsupportedR2Feature, string> = {
  object_tagging: 'Store tags/labels in arb.r2_object_registry.metadata_json instead.',
  object_lock: 'Use arb.r2_forensic_hold_rules and is_forensic_hold; do not rely on S3 Object Lock.',
  s3_acl: 'Use bucket scoped tokens, public bucket binding, or Worker gateway, not ACLs.',
  bucket_policy: 'Use Cloudflare dashboard/public bucket controls and application authorization.',
  bucket_versioning: 'Use immutable object keys and registry rows for version lineage.',
  bucket_replication: 'Use explicit backup/copy jobs if cross-account replication is required.',
  intelligent_tiering: 'Use explicit lifecycle decisions and Standard/InfrequentAccess classes.',
  bucket_notification_configuration: 'Use app/worker events and Postgres ledgers instead of S3 notifications.',
};

export function assertR2FeatureSupported(feature: string): void {
  if ((unsupportedR2Features as readonly string[]).includes(feature)) {
    throw new R2UnsupportedFeatureError(feature as UnsupportedR2Feature, mitigations[feature as UnsupportedR2Feature]);
  }
}

export function listR2Guardrails() {
  return unsupportedR2Features.map((feature) => ({ feature, mitigation: mitigations[feature] }));
}
