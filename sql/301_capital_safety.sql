BEGIN;

CREATE TABLE IF NOT EXISTS arb.capital_safety_policy (
  policy_version text PRIMARY KEY,
  is_active boolean NOT NULL DEFAULT false,
  min_comp_grounding_score numeric NOT NULL DEFAULT 0.70 CHECK (min_comp_grounding_score BETWEEN 0 AND 1),
  min_identity_confidence numeric NOT NULL DEFAULT 0.60 CHECK (min_identity_confidence BETWEEN 0 AND 1),
  min_comp_count integer NOT NULL DEFAULT 5 CHECK (min_comp_count >= 0),
  max_active_to_sold_ratio numeric NOT NULL DEFAULT 5 CHECK (max_active_to_sold_ratio >= 0),
  max_risk_score numeric NOT NULL DEFAULT 0.65 CHECK (max_risk_score BETWEEN 0 AND 1),
  block_ungrounded_buy boolean NOT NULL DEFAULT true,
  ledger_required_for_buy boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO arb.capital_safety_policy (policy_version, is_active)
VALUES ('capital-safety-v1', true)
ON CONFLICT (policy_version) DO UPDATE SET is_active = true, updated_at = now();

CREATE TABLE IF NOT EXISTS arb.capital_safety_assessment (
  id bigserial PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES arb.listings(id),
  candidate_id bigint REFERENCES arb.candidates(id),
  opportunity_queue_id bigint REFERENCES arb.opportunity_queue(id),
  decision_id uuid REFERENCES arb.decisions(id),
  policy_version text NOT NULL REFERENCES arb.capital_safety_policy(policy_version),
  assessment_status text NOT NULL CHECK (assessment_status IN ('PASSED','BLOCKED','REVIEW','ERROR')),
  capital_gate_status text NOT NULL CHECK (capital_gate_status IN ('PASS','BLOCK','REVIEW')),
  replay_status text NOT NULL CHECK (replay_status IN ('PASS','FAIL','NOT_RUN')) DEFAULT 'NOT_RUN',
  comp_grounding_status text NOT NULL CHECK (comp_grounding_status IN ('PASS','FAIL','NOT_RUN')) DEFAULT 'NOT_RUN',
  ledger_status text NOT NULL CHECK (ledger_status IN ('PASS','FAIL','NOT_RUN')) DEFAULT 'NOT_RUN',
  gate_reason_codes text[] NOT NULL DEFAULT '{}',
  risk_flags text[] NOT NULL DEFAULT '{}',
  comp_grounding_score numeric,
  replay_signature text,
  input_hash text NOT NULL,
  output_hash text NOT NULL,
  assessment_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capital_safety_assessment_listing_created ON arb.capital_safety_assessment(listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capital_safety_assessment_status_created ON arb.capital_safety_assessment(assessment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capital_safety_assessment_correlation ON arb.capital_safety_assessment(correlation_id);

CREATE TABLE IF NOT EXISTS arb.forensic_mutation_ledger (
  id bigserial PRIMARY KEY,
  correlation_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  mutation_type text NOT NULL,
  actor text NOT NULL,
  before_hash text,
  after_hash text NOT NULL,
  payload_hash text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_ledger_hash text,
  ledger_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forensic_ledger_entity ON arb.forensic_mutation_ledger(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forensic_ledger_correlation ON arb.forensic_mutation_ledger(correlation_id);

CREATE TABLE IF NOT EXISTS arb.replay_certification_run (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  policy_version text NOT NULL,
  replay_scope text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING','PASSED','FAILED','ERROR')),
  sample_size integer NOT NULL DEFAULT 0,
  passed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  drift_count integer NOT NULL DEFAULT 0,
  failure_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_replay_cert_run_status ON arb.replay_certification_run(status, started_at DESC);

CREATE TABLE IF NOT EXISTS arb.prong2_comp_grounding_assessment (
  id bigserial PRIMARY KEY,
  candidate_id bigint REFERENCES arb.candidates(id),
  listing_id uuid REFERENCES arb.listings(id),
  opportunity_queue_id bigint REFERENCES arb.opportunity_queue(id),
  market_id uuid REFERENCES arb.ebay_market(id),
  sold_count integer NOT NULL DEFAULT 0,
  active_count integer NOT NULL DEFAULT 0,
  active_to_sold_ratio numeric,
  identity_confidence numeric,
  title_fit_score numeric,
  category_fit_score numeric,
  condition_fit_score numeric,
  grounding_score numeric NOT NULL,
  grounding_status text NOT NULL CHECK (grounding_status IN ('PASS','FAIL','REVIEW')),
  reason_codes text[] NOT NULL DEFAULT '{}',
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  claim_token uuid,
  claimed_at timestamptz,
  claimed_by text,
  claim_expires_at timestamptz,
  process_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prong2_grounding_candidate_created ON arb.prong2_comp_grounding_assessment(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prong2_grounding_status_created ON arb.prong2_comp_grounding_assessment(grounding_status, created_at DESC);

CREATE TABLE IF NOT EXISTS arb.capital_safety_dead_letter (
  id bigserial PRIMARY KEY,
  worker_name text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  failure_code text NOT NULL,
  failure_message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capital_safety_dl_created ON arb.capital_safety_dead_letter(created_at DESC);

CREATE OR REPLACE FUNCTION arb.capital_safety_active_policy_version()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT policy_version FROM arb.capital_safety_policy WHERE is_active = true ORDER BY updated_at DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION arb.capital_safety_reset_stale_grounding_claims(ttl_seconds integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  UPDATE arb.prong2_comp_grounding_assessment
     SET claim_token = NULL,
         claimed_at = NULL,
         claimed_by = NULL,
         claim_expires_at = NULL,
         updated_at = now()
   WHERE claim_expires_at IS NOT NULL
     AND claim_expires_at < now() - make_interval(secs => ttl_seconds);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

COMMIT;
