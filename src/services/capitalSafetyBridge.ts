import type { Pool } from 'pg';
import type {
  AcquisitionCandidate,
  CompSelectionResult,
  MarketProfile,
  NormalizedIdentity,
  RawSafetyEvaluation,
  SafetyEvaluation,
} from '../contracts/acquisitionDecision';

/**
 * Capital Safety Bridge — Green Tier 1 production rewrite.
 *
 * Purpose:
 * - Protect real capital from hard failures.
 * - Stop soft confidence warnings from killing profitable BUY decisions.
 * - Produce clean, explainable hard blocks vs review warnings.
 *
 * Business rule:
 * - HARD blocker  => cannot auto-buy.
 * - SOFT warning  => can be queued as review_required / bid_monitor, not discarded.
 * - No blockers   => auto-buy eligible.
 */

const HARD_CAPITAL_BLOCKERS = new Set<string>([
  'CAPITAL_GATE_LISTING_NOT_LIVE',
  'CAPITAL_GATE_NOT_DEDUPE_PRIMARY',
  'CAPITAL_GATE_BUDGET_EXCEEDED',
  'CAPITAL_GATE_BANNED_CATEGORY',
  'CAPITAL_GATE_ZERO_ACCEPTED_COMPS',
  'CAPITAL_GATE_NO_ACCEPTED_COMPS',
  'CAPITAL_GATE_PRICE_EXCEEDS_MAX_BID',
  'CAPITAL_GATE_AUCTION_EXPIRED',
  'CAPITAL_GATE_SOURCE_UNAVAILABLE',
  'CAPITAL_GATE_CATEGORY_DISABLED',
  'REPLAY_CERTIFICATION_FAILED',
]);

const SOFT_CAPITAL_WARNINGS = new Set<string>([
  'CAPITAL_GATE_LOW_COMP_COUNT',
  'CAPITAL_GATE_WEAK_COMP_GROUNDING',
  'CAPITAL_GATE_NON_BUY_SAFE',
  'CAPITAL_SAFETY_GATE_REQUIRED_FOR_BUY',
  'REPLAY_CERTIFICATION_REQUIRED_FOR_BUY',
  'DB_MUTATION_LEDGER_REQUIRED_FOR_BUY',
  'FORENSIC_CHAIN_REQUIRED_FOR_BUY',
  'LOW_COMP_QUALITY_REQUIRES_CAPITAL_SAFETY_GATE',
]);

const PASS_TOKENS = ['PASS', 'PASSED', 'ALLOW', 'ALLOWED', 'APPROVED', 'SAFE', 'BUY'];
const BLOCK_TOKENS = ['BLOCK', 'BLOCKED', 'FAIL', 'FAILED', 'REJECT', 'REJECTED', 'DENY', 'DENIED'];

export async function evaluateCapitalSafety(input: {
  pool: Pool;
  candidate: AcquisitionCandidate;
  identity: NormalizedIdentity;
  comps: CompSelectionResult;
  market: MarketProfile;
  inputHash: string;
}): Promise<RawSafetyEvaluation> {
  const hardBlocks: string[] = [];
  const reviewReasons: string[] = [];

  const gate = await latestCapitalSafetyGate(input.pool, input.candidate);
  const replayStatus = await latestReplayStatus(input.pool, input.inputHash, input.candidate);
  const mutationReady = await mutationLedgerReady(input.pool, input.candidate);
  const forensicReady = await forensicChainReady(input.pool, input.candidate);

  if (!gate) {
    reviewReasons.push('CAPITAL_SAFETY_GATE_REQUIRED_FOR_BUY');
  } else {
    const classifiedGate = classifyGate(gate.gateStatus, gate.decisionCode, gate.blockReasons);
    hardBlocks.push(...classifiedGate.hardBlocks);
    reviewReasons.push(...classifiedGate.reviewReasons);
  }

  if (replayStatus === 'FAILED') hardBlocks.push('REPLAY_CERTIFICATION_FAILED');
  if (replayStatus === 'NOT_AVAILABLE') reviewReasons.push('REPLAY_CERTIFICATION_REQUIRED_FOR_BUY');
  if (!mutationReady) reviewReasons.push('DB_MUTATION_LEDGER_REQUIRED_FOR_BUY');
  if (!forensicReady) reviewReasons.push('FORENSIC_CHAIN_REQUIRED_FOR_BUY');

  if (input.comps.compQualityScore < 0.70) {
    reviewReasons.push('LOW_COMP_QUALITY_REQUIRES_CAPITAL_SAFETY_GATE');
  }

  const normalizedHardBlocks = unique(hardBlocks.map(normalizeReason));
  const normalizedReviewReasons = unique(reviewReasons.map(normalizeReason)).filter(
    (reason) => !normalizedHardBlocks.includes(reason),
  );

  const explicitGatePass = gate ? isPassingGate(gate.gateStatus, gate.decisionCode, gate.blockReasons) : false;
  const gateScore = explicitGatePass ? 0.35 : gate ? 0.18 : 0.08;
  const replayScore = replayStatus === 'PASSED' ? 0.15 : replayStatus === 'NOT_AVAILABLE' ? 0.06 : 0;
  const mutationScore = mutationReady ? 0.15 : 0.05;
  const forensicScore = forensicReady ? 0.12 : 0.04;
  const compScore = clamp(input.comps.compQualityScore, 0, 1) * 0.23;
  const marketScore = clamp(input.market.liquidityScore, 0, 1) * 0.10;

  const safetyScore = clamp(
    gateScore + replayScore + mutationScore + forensicScore + compScore + marketScore
      - normalizedHardBlocks.length * 0.42
      - normalizedReviewReasons.length * 0.035,
    0,
    1,
  );

  return {
    // ok now means hard-capital-safe. Review warnings are preserved, but do not kill BUY by themselves.
    ok: normalizedHardBlocks.length === 0,
    safetyScore: round(safetyScore, 4),
    blockingReasons: normalizedHardBlocks,
    reviewReasons: normalizedReviewReasons,
    replayCertificationStatus: replayStatus,
    compGroundingStatus: input.comps.compQualityScore >= 0.70 ? 'PASSED' : 'NOT_AVAILABLE',
    mutationLedgerStatus: mutationReady && forensicReady ? 'READY' : 'NOT_AVAILABLE',
  };
}

async function latestCapitalSafetyGate(pool: Pool, candidate: AcquisitionCandidate): Promise<{
  gateStatus: string;
  decisionCode: string;
  blockReasons: string[];
} | null> {
  if (!candidate.candidateId) return null;

  const result = await pool.query(
    `
    select gate_status, decision_code, block_reasons, gate_json
    from arb.capital_safety_gate
    where candidate_id = $1
      and listing_id = $2::uuid
      and ($3::bigint is null or opportunity_queue_id = $3::bigint or opportunity_queue_id is null)
    order by updated_at desc, created_at desc, id desc
    limit 1
    `,
    [candidate.candidateId, candidate.listingId, candidate.opportunityQueueId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const jsonReasons = Array.isArray(row.gate_json?.reasons) ? row.gate_json.reasons.map(String) : [];
  const blockReasons = Array.isArray(row.block_reasons) ? row.block_reasons.map(String) : [];

  return {
    gateStatus: String(row.gate_status ?? row.gate_json?.status ?? '').toUpperCase(),
    decisionCode: String(row.decision_code ?? row.gate_json?.allowedDecision ?? '').toUpperCase(),
    blockReasons: unique([...blockReasons, ...jsonReasons].map(normalizeReason)),
  };
}

async function latestReplayStatus(
  pool: Pool,
  inputHash: string,
  candidate: AcquisitionCandidate,
): Promise<SafetyEvaluation['replayCertificationStatus']> {
  const result = await pool.query(
    `
    select replay_status, result_json
    from arb.replay_requests
    where (payload_json->>'inputHash' = $1 or payload_json->>'acquisition_input_hash' = $1)
       or (payload_json->>'listingId' = $2)
       or (payload_json->>'candidateId' = $3)
    order by created_at desc, id desc
    limit 1
    `,
    [inputHash, candidate.listingId, candidate.candidateId ? String(candidate.candidateId) : ''],
  );

  const status = String(result.rows[0]?.replay_status ?? '').toUpperCase();
  const resultJson = result.rows[0]?.result_json ?? {};
  const resultStatus = typeof resultJson === 'object' && resultJson !== null
    ? String((resultJson as Record<string, unknown>).status ?? '').toUpperCase()
    : '';

  const combined = `${status} ${resultStatus}`;
  if (combined.includes('PASS') || combined.includes('CERTIFIED') || combined.includes('COMPLETED')) return 'PASSED';
  if (combined.includes('FAIL') || combined.includes('DRIFT') || combined.includes('ERROR')) return 'FAILED';
  return 'NOT_AVAILABLE';
}

async function mutationLedgerReady(pool: Pool, candidate: AcquisitionCandidate): Promise<boolean> {
  const result = await pool.query(
    `
    select exists(
      select 1
      from arb.db_mutation_ledger
      where (table_name in ('arb.opportunity_queue','opportunity_queue') and row_pk = $1)
         or (table_name in ('arb.candidates','candidates') and row_pk = $2)
         or (table_name in ('arb.listings','listings') and row_pk = $3)
    ) as ok
    `,
    [String(candidate.opportunityQueueId ?? ''), candidate.candidateId ? String(candidate.candidateId) : '', candidate.listingId],
  );

  return Boolean(result.rows[0]?.ok);
}

async function forensicChainReady(pool: Pool, candidate: AcquisitionCandidate): Promise<boolean> {
  const result = await pool.query(
    `
    select exists(
      select 1
      from arb.forensic_events
      where (entity_type in ('listing', 'arb.listings') and entity_pk = $1)
         or (entity_type in ('candidate', 'arb.candidates') and entity_pk = $2)
         or (entity_type in ('opportunity_queue', 'arb.opportunity_queue') and entity_pk = $3)
    ) as ok
    `,
    [candidate.listingId, candidate.candidateId ? String(candidate.candidateId) : '', String(candidate.opportunityQueueId ?? '')],
  );

  return Boolean(result.rows[0]?.ok);
}

function classifyGate(gateStatus: string, decisionCode: string, reasons: string[]): { hardBlocks: string[]; reviewReasons: string[] } {
  const hardBlocks: string[] = [];
  const reviewReasons: string[] = [];

  for (const rawReason of reasons.map(normalizeReason)) {
    if (HARD_CAPITAL_BLOCKERS.has(rawReason)) hardBlocks.push(rawReason);
    else if (SOFT_CAPITAL_WARNINGS.has(rawReason) || rawReason.startsWith('CAPITAL_GATE_')) reviewReasons.push(rawReason);
    else reviewReasons.push(rawReason);
  }

  if (!reasons.length && BLOCK_TOKENS.some((token) => gateStatus.includes(token) || decisionCode.includes(token))) {
    hardBlocks.push('CAPITAL_SAFETY_GATE_BLOCKED');
  }

  return { hardBlocks: unique(hardBlocks), reviewReasons: unique(reviewReasons) };
}

function isPassingGate(gateStatus: string, decisionCode: string, reasons: string[]): boolean {
  const classified = classifyGate(gateStatus, decisionCode, reasons);
  if (classified.hardBlocks.length > 0) return false;
  if (PASS_TOKENS.some((token) => gateStatus.includes(token) || decisionCode.includes(token))) return true;
  return classified.reviewReasons.length > 0;
}

function normalizeReason(reason: string): string {
  return reason.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
