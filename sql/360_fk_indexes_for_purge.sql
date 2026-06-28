
-- sql/360: add missing FK-column indexes (required for fast deletes/cascades + the retention purge)
CREATE INDEX IF NOT EXISTS ix_csa_candidate_id  ON arb.capital_safety_assessment(candidate_id);
CREATE INDEX IF NOT EXISTS ix_csg_listing_id    ON arb.capital_safety_gate(listing_id);
CREATE INDEX IF NOT EXISTS ix_crri_candidate_id ON arb.category_recovery_run_item(candidate_id);
CREATE INDEX IF NOT EXISTS ix_p2cga_listing_id  ON arb.prong2_comp_grounding_assessment(listing_id);
CREATE INDEX IF NOT EXISTS ix_rcrq_candidate_id ON arb.rejected_candidate_review_queue(candidate_id);
CREATE INDEX IF NOT EXISTS ix_rcrq_listing_id   ON arb.rejected_candidate_review_queue(listing_id);
