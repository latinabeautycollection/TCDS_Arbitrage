import type { Pool } from 'pg';

export interface R2RegistryInput {
  bucketName: string;
  objectKey: string;
  environment?: string;
  storageClass?: 'Standard' | 'InfrequentAccess';
  objectRole: 'original' | 'processed' | 'thumbnail' | 'evidence' | 'review' | 'temp' | 'deadletter' | 'analytics' | 'other';
  contentType?: string;
  sizeBytes: number;
  etag?: string;
  sha256?: string;
  perceptualHash?: string;
  publicUrl?: string;
  isPublic?: boolean;
  listingId?: string;
  candidateId?: number;
  sourceListingNormalizedId?: number;
  ebayListingFk?: number;
  ebayOrderFk?: number;
  photoAssetId?: string;
  processRunId?: string;
  metadataJson?: Record<string, unknown>;
}

export interface RetentionCandidate {
  id: string;
  bucket_name: string;
  object_key: string;
  object_role: string;
  storage_class: 'Standard' | 'InfrequentAccess';
  size_bytes: number;
  created_at: string;
  listing_status?: string | null;
  order_status?: string | null;
  dispute_count: number;
  return_count: number;
  estimated_value_usd?: string | null;
  is_forensic_hold: boolean;
}

export class R2StorageOptimizationRepository {
  constructor(private readonly pool: Pool) {}

  async upsertObject(input: R2RegistryInput): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO arb.r2_object_registry(
        bucket_name, object_key, environment, storage_class, object_role, content_type, size_bytes, etag, sha256,
        perceptual_hash, public_url, is_public, listing_id, candidate_id, source_listing_normalized_id,
        ebay_listing_fk, ebay_order_fk, photo_asset_id, process_run_id, metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT(bucket_name, object_key) DO UPDATE SET
        storage_class=EXCLUDED.storage_class,
        size_bytes=EXCLUDED.size_bytes,
        etag=EXCLUDED.etag,
        sha256=EXCLUDED.sha256,
        perceptual_hash=EXCLUDED.perceptual_hash,
        public_url=EXCLUDED.public_url,
        is_public=EXCLUDED.is_public,
        last_verified_at=now(),
        updated_at=now(),
        metadata_json=arb.r2_object_registry.metadata_json || EXCLUDED.metadata_json
      RETURNING id`,
      [
        input.bucketName,
        input.objectKey,
        input.environment ?? 'prod',
        input.storageClass ?? 'Standard',
        input.objectRole,
        input.contentType ?? null,
        input.sizeBytes,
        input.etag ?? null,
        input.sha256 ?? null,
        input.perceptualHash ?? null,
        input.publicUrl ?? null,
        input.isPublic ?? false,
        input.listingId ?? null,
        input.candidateId ?? null,
        input.sourceListingNormalizedId ?? null,
        input.ebayListingFk ?? null,
        input.ebayOrderFk ?? null,
        input.photoAssetId ?? null,
        input.processRunId ?? null,
        JSON.stringify(input.metadataJson ?? {}),
      ],
    );
    return result.rows[0]!.id;
  }

  async claimRetentionCandidates(limit: number): Promise<RetentionCandidate[]> {
    const result = await this.pool.query<RetentionCandidate>(
      `SELECT r.*, el.listing_status, eo.order_status,
              COALESCE(lfr.return_count, 0)::int AS return_count,
              COALESCE(lfr.dispute_count, 0)::int AS dispute_count,
              COALESCE(el.listing_price_usd, l.current_price, 0) AS estimated_value_usd
       FROM arb.r2_object_registry r
       LEFT JOIN arb.ebay_listing el ON el.source_listing_normalized_id = r.source_listing_normalized_id
       LEFT JOIN arb.ebay_order eo ON eo.ebay_listing_fk = el.id
       LEFT JOIN arb.listing_feedback_rollups lfr ON lfr.ebay_listing_fk = el.id
       LEFT JOIN arb.listings l ON l.id = r.listing_id
       WHERE r.lifecycle_status NOT IN ('deleted','error')
         AND r.last_lifecycle_checked_at IS DISTINCT FROM now()
         AND (r.last_lifecycle_checked_at IS NULL OR r.last_lifecycle_checked_at < now() - interval '12 hours')
       ORDER BY r.is_forensic_hold DESC, r.created_at ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async recordLifecycleDecision(args: {
    registryId: string;
    decision: string;
    reasonCodes: string[];
    processRunId?: string;
    decisionJson?: Record<string, unknown>;
    estimatedMonthlySavingsUsd?: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO arb.r2_lifecycle_policy_decisions(registry_id, decision, reason_codes, process_run_id, decision_json, estimated_monthly_savings_usd)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [args.registryId, args.decision, args.reasonCodes, args.processRunId ?? null, JSON.stringify(args.decisionJson ?? {}), args.estimatedMonthlySavingsUsd ?? 0],
    );
  }

  async markLifecycleStatus(registryId: string, status: string, patch: Record<string, unknown> = {}): Promise<void> {
    await this.pool.query(
      `UPDATE arb.r2_object_registry
       SET lifecycle_status=$2,
           storage_class=COALESCE($3, storage_class),
           retention_until=COALESCE($4, retention_until),
           is_forensic_hold=COALESCE($5, is_forensic_hold),
           forensic_hold_reason=COALESCE($6, forensic_hold_reason),
           last_lifecycle_checked_at=now(),
           deleted_at=CASE WHEN $2='deleted' THEN now() ELSE deleted_at END,
           updated_at=now()
       WHERE id=$1`,
      [registryId, status, patch.storageClass ?? null, patch.retentionUntil ?? null, patch.isForensicHold ?? null, patch.forensicHoldReason ?? null],
    );
  }

  async insertPrivateAccessAudit(input: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `INSERT INTO arb.r2_private_access_audit(request_id,bucket_name,object_key,access_purpose,actor_type,actor_id,actor_name,source_ip,user_agent,allowed,denial_reason,bytes_served,status_code,signed_url_expires_at,request_metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        input.requestId ?? null,
        input.bucketName,
        input.objectKey,
        input.accessPurpose ?? 'review',
        input.actorType ?? 'api',
        input.actorId ?? null,
        input.actorName ?? null,
        input.sourceIp ?? null,
        input.userAgent ?? null,
        input.allowed ?? false,
        input.denialReason ?? null,
        input.bytesServed ?? null,
        input.statusCode ?? null,
        input.signedUrlExpiresAt ?? null,
        JSON.stringify(input.requestMetadataJson ?? {}),
      ],
    );
  }

  async rollupBucketUsage(metricDate: string, processRunId?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO arb.r2_bucket_usage_daily(metric_date,bucket_name,environment,storage_class,object_count,total_bytes,estimated_storage_cost_usd,estimated_total_cost_usd,process_run_id)
       SELECT $1::date, bucket_name, environment, storage_class, count(*), COALESCE(sum(size_bytes),0),
              CASE WHEN storage_class='InfrequentAccess' THEN COALESCE(sum(size_bytes),0)::numeric/1024/1024/1024*0.01 ELSE COALESCE(sum(size_bytes),0)::numeric/1024/1024/1024*0.015 END,
              CASE WHEN storage_class='InfrequentAccess' THEN COALESCE(sum(size_bytes),0)::numeric/1024/1024/1024*0.01 ELSE COALESCE(sum(size_bytes),0)::numeric/1024/1024/1024*0.015 END,
              $2
       FROM arb.r2_object_registry
       WHERE lifecycle_status <> 'deleted'
       GROUP BY bucket_name, environment, storage_class
       ON CONFLICT(metric_date,bucket_name,storage_class) DO UPDATE SET
         object_count=EXCLUDED.object_count,
         total_bytes=EXCLUDED.total_bytes,
         estimated_storage_cost_usd=EXCLUDED.estimated_storage_cost_usd,
         estimated_total_cost_usd=EXCLUDED.estimated_total_cost_usd`,
      [metricDate, processRunId ?? null],
    );
  }
}
