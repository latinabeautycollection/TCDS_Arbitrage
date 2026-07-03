-- Domain 4 Listing Intelligence Engine V3
-- Additive-only migration aligned to the current arb schema.
-- Does not replace existing source-of-truth tables.

BEGIN;

CREATE TABLE IF NOT EXISTS arb.listing_ai_generation_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_listing_normalized_id bigint NOT NULL REFERENCES arb.listing_normalized(id),
  arbitrage_decision_id bigint REFERENCES arb.arbitrage_decision(id),
  ebay_listing_draft_id bigint REFERENCES arb.ebay_listing_draft(id),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  run_status text NOT NULL DEFAULT 'STARTED' CHECK (run_status IN ('STARTED','SUCCEEDED','FAILED','HUMAN_REVIEW','BLOCKED')),
  ai_consensus_status text,
  model_plan_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_flags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  cost_usd numeric NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text
);

CREATE TABLE IF NOT EXISTS arb.listing_ai_model_outputs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generation_run_id bigint NOT NULL REFERENCES arb.listing_ai_generation_runs(id),
  provider text NOT NULL CHECK (provider IN ('OPENAI','CLAUDE','GEMINI','SYSTEM')),
  model_name text,
  task_name text NOT NULL,
  input_hash text,
  prompt_version text,
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_score numeric,
  risk_flags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  tokens_input integer,
  tokens_output integer,
  cost_usd numeric NOT NULL DEFAULT 0,
  latency_ms integer,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.listing_image_assets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_listing_normalized_id bigint NOT NULL REFERENCES arb.listing_normalized(id),
  ebay_listing_draft_id bigint REFERENCES arb.ebay_listing_draft(id),
  source_url text,
  original_url text,
  cleaned_url text,
  provider text,
  image_role text NOT NULL DEFAULT 'GALLERY' CHECK (image_role IN ('PRIMARY','GALLERY','DETAIL','DEFECT','PACKAGING')),
  cleanup_status text NOT NULL DEFAULT 'PENDING' CHECK (cleanup_status IN ('PENDING','SKIPPED','SUCCEEDED','FAILED')),
  compliance_status text NOT NULL DEFAULT 'UNKNOWN' CHECK (compliance_status IN ('UNKNOWN','PASS','WARN','FAIL')),
  width integer,
  height integer,
  image_hash text,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.listing_human_review_decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ebay_listing_draft_id bigint NOT NULL REFERENCES arb.ebay_listing_draft(id),
  source_listing_normalized_id bigint NOT NULL REFERENCES arb.listing_normalized(id),
  review_status text NOT NULL DEFAULT 'QUEUED' CHECK (review_status IN ('QUEUED','APPROVED','REJECTED','NEEDS_REVISION','PUBLISHED')),
  review_reason_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.ebay_policy_cache (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cache_key text NOT NULL UNIQUE,
  marketplace_id text NOT NULL,
  category_id text,
  policy_type text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

ALTER TABLE arb.ebay_listing_draft
  ADD COLUMN IF NOT EXISTS ai_generation_run_id bigint REFERENCES arb.listing_ai_generation_runs(id),
  ADD COLUMN IF NOT EXISTS ai_consensus_status text,
  ADD COLUMN IF NOT EXISTS ai_consensus_score numeric,
  ADD COLUMN IF NOT EXISTS photo_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS seo_score numeric,
  ADD COLUMN IF NOT EXISTS compliance_score numeric,
  ADD COLUMN IF NOT EXISTS disclosure_score numeric,
  ADD COLUMN IF NOT EXISTS persuasive_copy_score numeric,
  ADD COLUMN IF NOT EXISTS human_review_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS publish_blockers_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS image_assets_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_trace_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE arb.ebay_listing
  ADD COLUMN IF NOT EXISTS ai_generation_run_id bigint REFERENCES arb.listing_ai_generation_runs(id),
  ADD COLUMN IF NOT EXISTS publish_request_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS publish_response_json jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO arb.process_registry (process_name, phase_no, process_group, description, owner_team, active_flag)
VALUES
('domain4_listing_generate_draft_v3', 3, 'DOMAIN4_LISTING', 'Generate AI-assisted eBay listing drafts using consensus AI, SEO, image, catalog, taxonomy, and policy validation.', 'TCDS', true),
('domain4_listing_publish_v3', 3, 'DOMAIN4_LISTING', 'Publish approved eBay listing drafts through eBay Inventory API after human and policy gates.', 'TCDS', true),
('domain4_listing_worker_v3', 3, 'DOMAIN4_LISTING', 'Process queued Domain 4 listing jobs.', 'TCDS', true)
ON CONFLICT (process_name) DO UPDATE SET
  description = EXCLUDED.description,
  active_flag = true,
  updated_at = now();

INSERT INTO arb.feature_flags (flag_key, is_enabled, description)
VALUES
('domain4_listing_ai_v3_enabled', true, 'Enable Domain 4 AI Listing Intelligence V3 generation.'),
('domain4_listing_auto_publish_enabled', false, 'Allow approved drafts to publish automatically. Keep false until certified.'),
('domain4_listing_image_cleanup_enabled', false, 'Enable PhotoRoom/remove.bg cleanup. Non-blocking even when enabled.'),
('domain4_listing_require_human_approval', true, 'Require human approval before eBay publish.')
ON CONFLICT (flag_key) DO UPDATE SET
  description = EXCLUDED.description,
  updated_at = now();

CREATE INDEX IF NOT EXISTS idx_listing_ai_runs_source ON arb.listing_ai_generation_runs(source_listing_normalized_id);
CREATE INDEX IF NOT EXISTS idx_listing_ai_outputs_run ON arb.listing_ai_model_outputs(generation_run_id);
CREATE INDEX IF NOT EXISTS idx_listing_image_assets_source ON arb.listing_image_assets(source_listing_normalized_id);
CREATE INDEX IF NOT EXISTS idx_listing_review_draft ON arb.listing_human_review_decisions(ebay_listing_draft_id);

COMMIT;
