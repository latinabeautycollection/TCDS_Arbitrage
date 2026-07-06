BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO arb.process_registry(process_name, phase_no, process_group, description, owner_team)
VALUES
('domain5.photography.v2.process', 3, 'DOMAIN5_PRODUCT_PHOTOGRAPHY', 'Process and certify listing-ready product photography for eBay arbitrage.', 'TCDS_ARBITRAGE'),
('domain5.photography.v2.review', 3, 'DOMAIN5_PRODUCT_PHOTOGRAPHY', 'Human review and override workflow for product photography.', 'TCDS_ARBITRAGE'),
('domain5.photography.v2.worker', 3, 'DOMAIN5_PRODUCT_PHOTOGRAPHY', 'Async worker for photo processing jobs.', 'TCDS_ARBITRAGE')
ON CONFLICT (process_name) DO UPDATE SET
  description = EXCLUDED.description,
  active_flag = true,
  updated_at = now();

CREATE TABLE IF NOT EXISTS arb.product_photo_assets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint REFERENCES arb.candidates(id),
  listing_id uuid REFERENCES arb.listings(id),
  source_listing_normalized_id bigint REFERENCES arb.listing_normalized(id),
  ebay_listing_draft_fk bigint REFERENCES arb.ebay_listing_draft(id),
  photo_role text NOT NULL DEFAULT 'UNKNOWN' CHECK (photo_role IN ('HERO','FRONT','BACK','LEFT','RIGHT','TOP','BOTTOM','SERIAL','DEFECT','ACCESSORY','PACKAGING','LABEL','UNKNOWN')),
  source_url text,
  original_uri text NOT NULL,
  processed_uri text,
  thumbnail_uri text,
  original_sha256 text NOT NULL CHECK (length(original_sha256) = 64),
  processed_sha256 text CHECK (processed_sha256 IS NULL OR length(processed_sha256) = 64),
  perceptual_hash text,
  width integer,
  height integer,
  mime_type text,
  file_size_bytes bigint,
  exif_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  transformation_chain_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_score numeric NOT NULL DEFAULT 0 CHECK (quality_score >= 0 AND quality_score <= 100),
  sharpness_score numeric,
  exposure_score numeric,
  background_score numeric,
  watermark_risk_score numeric,
  text_overlay_risk_score numeric,
  duplicate_risk_score numeric,
  authenticity_risk_score numeric,
  ai_alteration_risk_score numeric,
  ebay_compliance_status text NOT NULL DEFAULT 'PENDING' CHECK (ebay_compliance_status IN ('PASS','REVIEW','FAIL','PENDING')),
  approval_status text NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('APPROVED','REJECTED','REVIEW','PENDING')),
  rejection_reasons_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_trace_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  process_step_id bigint REFERENCES arb.process_steps(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(original_sha256, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_product_photo_assets_candidate ON arb.product_photo_assets(candidate_id);
CREATE INDEX IF NOT EXISTS idx_product_photo_assets_listing ON arb.product_photo_assets(listing_id);
CREATE INDEX IF NOT EXISTS idx_product_photo_assets_status ON arb.product_photo_assets(approval_status, ebay_compliance_status);

CREATE TABLE IF NOT EXISTS arb.photo_processing_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  candidate_id bigint REFERENCES arb.candidates(id),
  listing_id uuid REFERENCES arb.listings(id),
  source_listing_normalized_id bigint REFERENCES arb.listing_normalized(id),
  ebay_listing_draft_fk bigint REFERENCES arb.ebay_listing_draft(id),
  category_key text,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','RETRY','DEAD_LETTER','CANCELLED')),
  priority integer NOT NULL DEFAULT 100,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  lock_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_class text,
  poison_detected boolean NOT NULL DEFAULT false,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  correlation_id text,
  causation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photo_processing_jobs_claim ON arb.photo_processing_jobs(status, priority, available_at, lock_expires_at);

CREATE TABLE IF NOT EXISTS arb.photo_set_assessments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint REFERENCES arb.candidates(id),
  listing_id uuid REFERENCES arb.listings(id),
  source_listing_normalized_id bigint REFERENCES arb.listing_normalized(id),
  ebay_listing_draft_fk bigint REFERENCES arb.ebay_listing_draft(id),
  category_key text,
  approved_photo_count integer NOT NULL DEFAULT 0,
  total_photo_count integer NOT NULL DEFAULT 0,
  photo_set_quality_score numeric NOT NULL DEFAULT 0,
  primary_hero_score numeric,
  angle_coverage_score numeric,
  defect_disclosure_score numeric,
  serial_evidence_score numeric,
  accessory_coverage_score numeric,
  packaging_evidence_score numeric,
  buyer_trust_score numeric,
  dispute_defense_score numeric,
  ebay_compliance_status text NOT NULL DEFAULT 'PENDING' CHECK (ebay_compliance_status IN ('PASS','REVIEW','FAIL','PENDING')),
  review_required boolean NOT NULL DEFAULT false,
  required_missing_angles_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  flags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  listing_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  assessment_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photo_set_assessments_candidate ON arb.photo_set_assessments(candidate_id);

CREATE TABLE IF NOT EXISTS arb.photo_review_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint REFERENCES arb.candidates(id),
  listing_id uuid REFERENCES arb.listings(id),
  photo_asset_id bigint REFERENCES arb.product_photo_assets(id),
  photo_set_assessment_id bigint REFERENCES arb.photo_set_assessments(id),
  review_type text NOT NULL CHECK (review_type IN ('PHOTO_ASSET','PHOTO_SET','AI_ALTERATION','WATERMARK','COMPLIANCE','MISSING_EVIDENCE')),
  review_priority integer NOT NULL DEFAULT 100,
  review_status text NOT NULL DEFAULT 'QUEUED' CHECK (review_status IN ('QUEUED','IN_REVIEW','APPROVED_OVERRIDE','REJECTED_CONFIRMED','NEEDS_RESHOOT','DISMISSED')),
  reason_codes text[] NOT NULL DEFAULT '{}',
  review_summary text NOT NULL,
  review_details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewer_id text,
  reviewer_notes text,
  reviewed_at timestamptz,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photo_review_queue_status ON arb.photo_review_queue(review_status, review_priority, created_at);

CREATE TABLE IF NOT EXISTS arb.photo_provider_call_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  provider_name text NOT NULL,
  model_name text,
  method_name text NOT NULL,
  entity_type text,
  entity_pk text,
  input_hash text,
  request_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms integer,
  cost_estimate_usd numeric NOT NULL DEFAULT 0,
  success boolean NOT NULL DEFAULT true,
  retryable boolean NOT NULL DEFAULT false,
  error_class text,
  error_message text,
  called_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photo_provider_call_ledger_provider ON arb.photo_provider_call_ledger(provider_name, called_at);

CREATE OR REPLACE VIEW arb.v_listing_ready_photos AS
SELECT
  COALESCE(pa.candidate_id, psa.candidate_id) AS candidate_id,
  COALESCE(pa.listing_id, psa.listing_id) AS listing_id,
  max(psa.photo_set_quality_score) AS photo_quality_score,
  max(psa.buyer_trust_score) AS buyer_trust_score,
  max(psa.dispute_defense_score) AS dispute_defense_score,
  jsonb_agg(
    jsonb_build_object(
      'photo_asset_id', pa.id,
      'role', pa.photo_role,
      'uri', COALESCE(pa.processed_uri, pa.original_uri),
      'thumbnail_uri', pa.thumbnail_uri,
      'quality_score', pa.quality_score,
      'width', pa.width,
      'height', pa.height,
      'sha256', COALESCE(pa.processed_sha256, pa.original_sha256)
    ) ORDER BY
      CASE pa.photo_role WHEN 'HERO' THEN 1 WHEN 'FRONT' THEN 2 WHEN 'BACK' THEN 3 WHEN 'SERIAL' THEN 98 ELSE 50 END,
      pa.quality_score DESC
  ) FILTER (WHERE pa.approval_status = 'APPROVED' AND pa.ebay_compliance_status = 'PASS') AS listing_photos,
  count(*) FILTER (WHERE pa.approval_status = 'APPROVED' AND pa.ebay_compliance_status = 'PASS') AS approved_photo_count
FROM arb.product_photo_assets pa
LEFT JOIN arb.photo_set_assessments psa
  ON psa.candidate_id = pa.candidate_id
GROUP BY COALESCE(pa.candidate_id, psa.candidate_id), COALESCE(pa.listing_id, psa.listing_id);

COMMIT;
