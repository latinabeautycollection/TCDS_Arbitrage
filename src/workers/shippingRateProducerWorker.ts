import { pool } from '../db/pool';
import { ShippingDestinationModelEngine } from '../domains/shipping/engines/shippingDestinationModelEngine';
import { sandboxCarrierRateAdapter } from '../domains/shipping/adapters/sandboxCarrierRateAdapter';

const DEFAULT_WEIGHT_LBS = Number(process.env.SHIPPING_DEFAULT_WEIGHT_LBS ?? 2);
const SANDBOX_SOURCE = 'domain3_destination_model_sandbox';

type CandRow = {
  candidate_id: number;
  listing_id: string;
  normalized_id: number | null;
  shipping_weight_lbs: number | null;
};

async function loadCandidate(candidateId: number): Promise<CandRow | null> {
  const { rows } = await pool.query(
    `select c.id as candidate_id, l.id::text as listing_id,
            n.id as normalized_id, l.shipping_weight_lbs
     from arb.candidates c
     join arb.listings l on l.id = c.listing_id
     left join arb.listing_normalized n on n.listing_external_id = l.listing_external_id
     where c.id = $1`,
    [candidateId],
  );
  return (rows[0] as CandRow) ?? null;
}

export async function produceForCandidate(candidateId: number) {
  const cand = await loadCandidate(candidateId);
  if (!cand) return null;

  const engine = new ShippingDestinationModelEngine(pool, sandboxCarrierRateAdapter);
  const weightLbs = Number(cand.shipping_weight_lbs ?? DEFAULT_WEIGHT_LBS);

  const { batchId, summary } = await engine.estimatePrePurchaseRate({
    candidateId: cand.candidate_id,
    sourceListingNormalizedId: cand.normalized_id ?? undefined,
    package: { weightLbs },
  });

  const { rows } = await pool.query(
    `select arb.fn_enqueue_shipping_capture_signal($1::jsonb) as outbox_id`,
    [JSON.stringify({
      entity_pk: cand.listing_id,
      entity_type: 'listing',
      source: SANDBOX_SOURCE,
      environment: 'sandbox',
      candidate_id: cand.candidate_id,
      listing_id: cand.listing_id,
      source_listing_normalized_id: cand.normalized_id,
      selected_carrier_code: 'WEIGHTED_MODEL',
      quoted_label_cost_usd: summary.conservativeCostUsd ?? summary.weightedAverageCostUsd,
      evidence_kind: 'PREPURCHASE_WEIGHTED_ESTIMATE',
      weighted_average_cost_usd: summary.weightedAverageCostUsd,
      p90_cost_usd: summary.p90CostUsd,
      worst_case_cost_usd: summary.worstCaseCostUsd,
      confidence_score: summary.confidenceScore,
      destination_count: summary.destinationCount,
    })],
  );

  return { batchId, weightLbs, summary, outboxId: rows[0].outbox_id };
}

if (require.main === module) {
  const id = Number(process.argv[2]);
  produceForCandidate(id)
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
