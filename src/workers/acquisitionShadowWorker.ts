import crypto from 'node:crypto';
import { Pool } from 'pg';
import { resolveAcquisitionIdentity } from '../acquisition/services/acquisitionIdentity';
import { buildAcquisitionCompSet } from '../acquisition/services/acquisitionCompSelection';
import { computeAcquisitionMarketProfile } from '../acquisition/services/acquisitionMarketAnalytics';
import { buildAcquisitionFinancialModel } from '../acquisition/services/acquisitionFinancialModel';
import { evaluateAcquisitionRules } from '../acquisition/services/acquisitionRulesEngine';
import type { AcquisitionCandidate, AcquisitionCategoryPolicy, SafetyEvaluation, ShippingSignal } from '../acquisition/contracts/acquisitionDecision';

const cfg = {
  workerName: process.env.ACQ_SHADOW_WORKER_NAME || 'acquisition-shadow-worker',
  claimStatus: process.env.DOMAIN1_CLAIM_STATUS || 'passed',
  batchSize: int(process.env.ACQ_SHADOW_BATCH_SIZE, 25),
  claimTtl: int(process.env.ACQ_SHADOW_CLAIM_TTL_SECONDS, 600),
  rescoreHours: int(process.env.ACQ_SHADOW_RESCORE_AFTER_HOURS, 12),
  idleMs: int(process.env.ACQ_SHADOW_IDLE_SLEEP_MS, 15000),
  liveBufferSec: int(process.env.CAPITAL_GATE_MIN_SECONDS_TO_END, 3600),
  cashOnHand: num(process.env.ACQ_DEFAULT_CASH_ON_HAND_USD, 10000),
  policyVersion: process.env.ACQ_POLICY_VERSION || 'acq-domain1-schema-v3',
};
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });
const RANK: Record<string, number> = { BUY: 4, WATCH: 3, REVIEW: 2, REJECT: 1 };

async function run(): Promise<void> {
  let running = true;
  const stop = () => { running = false; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  log('starting', { mode: process.env.ACQUISITION_ENGINE_MODE });
  while (running) {
    let ids: number[] = [];
    try { ids = await claim(); } catch (e) { log('claim_failed', { error: msg(e) }); await sleep(cfg.idleMs); continue; }
    if (ids.length === 0) { await sleep(cfg.idleMs); continue; }
    const rows = await hydrate(ids);
    for (const r of rows) {
      try { await scoreOne(r); } catch (e) { log('score_failed', { oqid: r.oqid, error: msg(e) }); }
    }
  }
  await pool.end();
}

async function claim(): Promise<number[]> {
  const res = await pool.query(
    `with claimable as (
       select oq.id from arb.opportunity_queue oq
       where oq.status = $1
         and not exists (select 1 from arb.acquisition_shadow_decisions sd where sd.opportunity_queue_id=oq.id and sd.created_at > now() - ($2||' hours')::interval)
         and not exists (select 1 from arb.acquisition_shadow_claims sc where sc.opportunity_queue_id=oq.id and sc.claim_expires_at > now())
       order by oq.priority_score desc nulls last, oq.id
       limit $3)
     insert into arb.acquisition_shadow_claims (opportunity_queue_id, claimed_by, claimed_at, claim_expires_at, last_status)
     select c.id, $4, now(), now() + ($5||' seconds')::interval, 'claimed' from claimable c
     on conflict (opportunity_queue_id) do update set claimed_by=excluded.claimed_by, claimed_at=now(), claim_expires_at=excluded.claim_expires_at, last_status='claimed', updated_at=now()
     returning opportunity_queue_id`,
    [cfg.claimStatus, String(cfg.rescoreHours), cfg.batchSize, cfg.workerName, String(cfg.claimTtl)]);
  return res.rows.map((x) => Number(x.opportunity_queue_id));
}

async function hydrate(ids: number[]): Promise<any[]> {
  const res = await pool.query(
    `select oq.id oqid, oq.candidate_id, oq.watchlist_id, oq.reason_json, oq.priority_score,
       c.listing_id, l.title, l.normalized_title, coalesce(l.description_clean, l.description_raw) description,
       l.brand, l.model, coalesce(l.category_key, l.category_id, c.source_category_key) category_key,
       l.condition_text, l.current_price, l.current_bid_price, l.buy_now_price,
       coalesce(l.inbound_shipping_usd, c.inbound_shipping_usd) inbound_shipping_usd, l.end_time,
       pw.activation_reason_json watchlist_json,
       em.sold_sample_json, em.active_sample_json, em.sold_prices_json, em.active_prices_json,
       em.sold_30d, em.active_count, em.median_sold_price, em.p25_sold_price, em.p75_sold_price,
       em.median_active_price, em.resale_anchor_price, em.liquidity_ratio,
       d.decision legacy_decision, d.reason_codes legacy_reason_codes, d.risk_flags legacy_risk_flags,
       d.max_bid_usd legacy_max_bid, d.estimated_profit_usd legacy_profit, d.estimated_roi legacy_roi,
       csa.capital_gate_status, csa.assessment_status, csa.comp_grounding_status, csa.replay_status, csa.ledger_status, csa.gate_reason_codes,
       ship.quoted_label_cost_usd, ship.carrier_code, ship.service_code, ship.payload_json ship_payload
     from arb.opportunity_queue oq
     join arb.candidates c on c.id=oq.candidate_id
     join arb.listings l on l.id=c.listing_id
     left join arb.product_watchlist pw on pw.id=oq.watchlist_id
     left join arb.ebay_market em on em.listing_id=l.id
     left join arb.decisions d on d.listing_id=c.listing_id
     left join lateral (select * from arb.capital_safety_assessment x where x.candidate_id=c.id order by created_at desc limit 1) csa on true
     left join lateral (select quoted_label_cost_usd, carrier_code, service_code, payload_json from arb.shipping_evidence se
                        where se.entity_pk = c.listing_id::text and se.entity_type in ('listing','arb.listings','acquisition_listing')
                          and coalesce(se.quoted_label_cost_usd,0) > 0
                          and (lower(coalesce(se.payload_json->>'source','')) like '%shipengine%' or se.payload_json ? 'shipengine_request_id')
                        order by se.created_at desc limit 1) ship on true
     where oq.id = any($1::bigint[])`,
    [ids]);
  return res.rows;
}

async function scoreOne(r: any): Promise<void> {
  const candidate = buildCandidate(r);
  const identity = resolveAcquisitionIdentity(candidate);
  const policy = await getPolicy(identity.categoryKey);
  const comps = buildAcquisitionCompSet({ identity, ebayMarketJson: candidate.ebayMarketJson });
  const market = computeAcquisitionMarketProfile(comps);
  const shippingSignal = buildShipping(r);
  const financial = buildAcquisitionFinancialModel({ candidate, policy, market, identity, cashOnHandUsd: cfg.cashOnHand, shippingSignal });
  const safety = buildSafety(r);
  const rules = evaluateAcquisitionRules({ policy, identity, comps, market, financial, safety });

  let d1: string = rules.status;
  const reasonCodes = [...rules.reasonCodes];
  const endMs = r.end_time ? new Date(r.end_time).getTime() : null;
  if (endMs === null || Number.isNaN(endMs) || endMs <= Date.now()) { d1 = 'REJECT'; reasonCodes.push('LISTING_ENDED'); }
  else if (endMs <= Date.now() + cfg.liveBufferSec * 1000 && d1 === 'BUY') { d1 = 'REVIEW'; reasonCodes.push('LISTING_ENDING_SOON'); }

  const legacy = r.legacy_decision ? String(r.legacy_decision) : null;
  const agreement = classify(legacy, d1);
  const profitDelta = numN(financial.estimatedProfitUsd) !== null && numN(r.legacy_profit) !== null ? round(numN(financial.estimatedProfitUsd)! - numN(r.legacy_profit)!, 2) : null;
  const roiDelta = numN(financial.estimatedRoi) !== null && numN(r.legacy_roi) !== null ? round(numN(financial.estimatedRoi)! - numN(r.legacy_roi)!, 6) : null;
  const capStatus = r.capital_gate_status ? String(r.capital_gate_status) : 'MISSING';

  await pool.query(
    `insert into arb.acquisition_shadow_decisions
       (opportunity_queue_id, listing_id, candidate_id, policy_version, legacy_decision, legacy_reason_codes, legacy_risk_flags, legacy_max_bid,
        domain1_decision, domain1_reason_codes, domain1_risk_flags, domain1_confidence, domain1_max_bid, profit_delta, roi_delta,
        agreement_status, capital_safety_status, shipping_signal_status, domain1_input_hash, comparison_json)
     values ($1,$2::uuid,$3,$4,$5,$6::text[],$7::text[],$8,$9,$10::text[],$11::text[],$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)`,
    [r.oqid, r.listing_id, r.candidate_id, policy.policyVersion, legacy, toArr(r.legacy_reason_codes), toArr(r.legacy_risk_flags), numN(r.legacy_max_bid),
     d1, dedupe(reasonCodes), dedupe(rules.riskFlags), rules.confidenceScore, numN(financial.maxBidUsd), profitDelta, roiDelta,
     agreement, capStatus, shippingSignal.source, identity.fingerprint,
     JSON.stringify({ identity: { categoryKey: identity.categoryKey, confidence: identity.identityConfidence, familyKey: identity.familyKey },
       market: { soldCount: market.soldCount, soldMedian: market.soldMedian, liquidity: market.liquidityScore },
       financial: { purchase: financial.estimatedPurchasePriceUsd, resale: financial.conservativeResaleUsd, profit: financial.estimatedProfitUsd, roi: financial.estimatedRoi, maxBid: financial.maxBidUsd },
       rules: { status: rules.status, rank: rules.rank, confidence: rules.confidenceScore }, gates: { liveness: reasonCodes.filter((x) => x.startsWith('LISTING_')), capital: capStatus, shipping: shippingSignal.source } })]);
  await pool.query(`update arb.acquisition_shadow_claims set last_status='scored', updated_at=now() where opportunity_queue_id=$1`, [r.oqid]);
  log('scored', { oqid: r.oqid, legacy, domain1: d1, agreement });
}

function buildCandidate(r: any): AcquisitionCandidate {
  return {
    opportunityQueueId: Number(r.oqid), candidateId: r.candidate_id != null ? Number(r.candidate_id) : null,
    listingId: String(r.listing_id), watchlistId: r.watchlist_id != null ? Number(r.watchlist_id) : null,
    title: String(r.title ?? ''), normalizedTitle: r.normalized_title ?? null, description: r.description ?? null,
    brand: r.brand ?? null, model: r.model ?? null, categoryKey: r.category_key ?? null, conditionText: r.condition_text ?? null,
    currentPrice: numN(r.current_price), currentBidPrice: numN(r.current_bid_price), buyNowPrice: numN(r.buy_now_price),
    inboundShippingUsd: numN(r.inbound_shipping_usd), quantityAvailable: 1,
    opportunityReasonJson: r.reason_json ?? {}, watchlistJson: r.watchlist_json ?? {},
    ebayMarketJson: { sold_sample_json: r.sold_sample_json ?? [], active_sample_json: r.active_sample_json ?? [],
      sold_prices_json: r.sold_prices_json ?? [], active_prices_json: r.active_prices_json ?? [],
      sold_30d: r.sold_30d, active_count: r.active_count, median_sold_price: r.median_sold_price,
      p25_sold_price: r.p25_sold_price, p75_sold_price: r.p75_sold_price, median_active_price: r.median_active_price,
      resale_anchor_price: r.resale_anchor_price, liquidity_ratio: r.liquidity_ratio },
  };
}

function buildSafety(r: any): SafetyEvaluation {
  const gate = String(r.capital_gate_status ?? '').toUpperCase();
  const has = !!r.capital_gate_status;
  const reasons: string[] = Array.isArray(r.gate_reason_codes) ? r.gate_reason_codes.map(String) : [];
  const pass = gate === 'PASS';
  return { ok: pass, safetyScore: !has ? 0 : pass ? 0.9 : 0.2,
    blockingReasons: !has ? ['CAPITAL_SAFETY_ASSESSMENT_MISSING'] : pass ? [] : reasons.filter((x) => x.startsWith('CAPITAL_GATE_')),
    reviewReasons: [], replayCertificationStatus: r.replay_status === 'PASS' ? 'PASSED' : r.replay_status === 'FAIL' ? 'FAILED' : 'NOT_AVAILABLE',
    compGroundingStatus: r.comp_grounding_status === 'PASS' ? 'PASSED' : r.comp_grounding_status === 'FAIL' ? 'FAILED' : 'NOT_AVAILABLE',
    mutationLedgerStatus: String(r.ledger_status ?? '').toUpperCase() === 'PASS' ? 'READY' : 'NOT_AVAILABLE' };
}

function buildShipping(r: any): Partial<ShippingSignal> {
  const cost = numN(r.quoted_label_cost_usd);
  if (cost && cost > 0) return { source: 'shipengine', outboundShippingUsd: cost, confidence: 0.8, carrierCode: r.carrier_code ?? null, serviceCode: r.service_code ?? null, requestId: null, riskFlags: [] };
  return { source: 'missing', outboundShippingUsd: undefined, confidence: 0, carrierCode: null, serviceCode: null, requestId: null, riskFlags: ['SHIPENGINE_SHIPPING_SIGNAL_MISSING'] };
}

function classify(legacy: string | null, d1: string): string {
  if (!legacy) return 'DATA_MISSING';
  if (legacy === d1) return legacy === 'BUY' ? 'AGREE_BUY' : legacy === 'REJECT' ? 'AGREE_REJECT' : legacy === 'REVIEW' ? 'AGREE_REVIEW' : 'AGREE_' + legacy;
  if (legacy === 'BUY' && d1 === 'REVIEW') return 'LEGACY_BUY_DOMAIN1_REVIEW';
  if (legacy === 'BUY' && d1 === 'REJECT') return 'LEGACY_BUY_DOMAIN1_REJECT';
  if (legacy === 'REJECT' && d1 === 'BUY') return 'LEGACY_REJECT_DOMAIN1_BUY';
  const lr = RANK[legacy] ?? 0, dr = RANK[d1] ?? 0;
  return dr < lr ? 'DOMAIN1_MORE_CONSERVATIVE' : 'DOMAIN1_MORE_AGGRESSIVE';
}

const policyCache = new Map<string, AcquisitionCategoryPolicy>();
async function getPolicy(categoryKey: string): Promise<AcquisitionCategoryPolicy> {
  const key = categoryKey || 'default';
  const cached = policyCache.get(key); if (cached) return cached;
  const r = await pool.query(
    `select p.scoring_version, c.* from arb.acquisition_category_policy c
     join arb.acquisition_policy_version p on p.policy_version=c.policy_version
     where c.policy_version=$1 and c.is_active=true and c.category_key in ($2,'default')
     order by case when c.category_key=$2 then 0 else 1 end limit 1`, [cfg.policyVersion, key]);
  const row = r.rows[0]; if (!row) throw new Error('no policy for ' + key);
  const p: AcquisitionCategoryPolicy = { policyVersion: String(row.policy_version), scoringVersion: String(row.scoring_version), categoryKey: String(row.category_key),
    minSoldCount: +row.min_sold_count, minProfitUsd: +row.min_profit_usd, minRoi: +row.min_roi, maxActiveSoldRatio: +row.max_active_sold_ratio,
    minIdentityConfidence: +row.min_identity_confidence, minCompQuality: +row.min_comp_quality, maxVolatility: +row.max_volatility,
    returnRiskRate: +row.return_risk_rate, damageRiskRate: +row.damage_risk_rate, disputeRiskRate: +row.dispute_risk_rate,
    marketplaceFeeRate: +row.marketplace_fee_rate, paymentFeeRate: +row.payment_fee_rate, salesTaxRate: +row.sales_tax_rate,
    warehouseHandlingUsd: +row.warehouse_handling_usd, storageReserveUsd: +row.storage_reserve_usd, packagingCostUsd: +row.packaging_cost_usd,
    insuranceReserveRate: +row.insurance_reserve_rate, signatureReserveUsd: +row.signature_reserve_usd, carrierRiskRate: +row.carrier_risk_rate,
    shippingBufferUsd: +row.shipping_buffer_usd, maxItemCapitalPct: +row.max_item_capital_pct, maxCategoryCapitalPct: +row.max_category_capital_pct,
    maxFamilyCapitalPct: +row.max_family_capital_pct, cashReservePct: +row.cash_reserve_pct, highProfitReviewMultiplier: +row.high_profit_review_multiplier,
    minSafetyScoreForBuy: +row.min_safety_score_for_buy, categoryRankWeight: +row.category_rank_weight };
  policyCache.set(key, p); return p;
}

function int(v: string | undefined, d: number): number { const n = parseInt(v ?? '', 10); return Number.isFinite(n) ? n : d; }
function num(v: string | undefined, d: number): number { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : d; }
function numN(v: unknown): number | null { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function round(v: number, p = 2): number { const f = 10 ** p; return Math.round(v * f) / f; }
function toArr(v: unknown): string[] { return Array.isArray(v) ? v.map(String) : []; }
function dedupe(v: string[]): string[] { return Array.from(new Set(v)); }
function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function log(event: string, meta: Record<string, unknown>): void { console.log(JSON.stringify({ ts: new Date().toISOString(), worker: cfg.workerName, event, ...meta })); }

run().catch((e) => { console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'fatal', error: msg(e) })); process.exit(1); });
