import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import type { CapitalSafetyGateResult, CapitalSafetyPolicy, CompGroundingInput, CompGroundingResult, SafetyDecisionInput } from '../contracts/capitalSafety.types';
import { sha256 } from '../services/hashStable';

export interface LoggerLike { error(message: string, meta?: Record<string, unknown>): void; warn?(message: string, meta?: Record<string, unknown>): void; info?(message: string, meta?: Record<string, unknown>): void; }

export interface ClaimedOpportunityForSafety {
  opportunityQueueId: number;
  candidateId: number;
  listingId: string;
  decisionId: string | null;
  decision: 'BUY' | 'WATCH' | 'PASS' | 'REVIEW' | 'REJECT';
  expectedProfitUsd: number | null;
  roiPct: number | null;
  priorityScore: number | null;
  riskScore: number | null;
  identityConfidence: number | null;
  soldCount: number | null;
  activeCount: number | null;
  activeToSoldRatio: number | null;
  compGroundingScore: number | null;
  claimToken: string;
  // Phase 2.9 spec fields
  profitAnalysisDecisionCode: string | null;
  dedupeGateStatus: string | null;
  reviewRequired: boolean;
  isBundle: boolean;
  candidateTitle: string | null;
  totalCostBasisUsd: number | null;
}

export class CapitalSafetyRepository {
  public constructor(private readonly pool: Pool, private readonly logger: LoggerLike = console) {}

  public async writeHeartbeat(input: { workerName: string; workerInstanceId: string; status: string; details: Record<string, unknown> }): Promise<void> {
    await this.query(
      `insert into arb.worker_heartbeats(worker_name, worker_instance_id, status, details_json, last_seen_at)
       values($1,$2,$3,$4::jsonb,now())
       on conflict(worker_name, worker_instance_id) do update set status=excluded.status, details_json=excluded.details_json, last_seen_at=now(), updated_at=now()`,
      [input.workerName, input.workerInstanceId, input.status, JSON.stringify(input.details)],
      'writeHeartbeat',
    );
  }

  public async getActivePolicy(): Promise<CapitalSafetyPolicy> {
    const r = await this.query(`select * from arb.capital_safety_policy where is_active=true order by updated_at desc limit 1`, [], 'getActivePolicy');
    const row = r.rows[0];
    if (!row) throw new Error('No active capital safety policy found');
    return {
      policyVersion: String(row.policy_version),
      minCompGroundingScore: num(row.min_comp_grounding_score, 'min_comp_grounding_score'),
      minIdentityConfidence: num(row.min_identity_confidence, 'min_identity_confidence'),
      minCompCount: num(row.min_comp_count, 'min_comp_count'),
      maxActiveToSoldRatio: num(row.max_active_to_sold_ratio, 'max_active_to_sold_ratio'),
      maxRiskScore: num(row.max_risk_score, 'max_risk_score'),
      blockUngroundedBuy: Boolean(row.block_ungrounded_buy),
      ledgerRequiredForBuy: Boolean(row.ledger_required_for_buy),
    };
  }

  public async claimSafetyOpportunities(input: { workerId: string; batchSize: number; claimTtlSeconds: number }): Promise<ClaimedOpportunityForSafety[]> {
    const r = await this.query(
      `with claimable as (
       select oq.id
        from arb.opportunity_queue oq
        join arb.candidates c on c.id=oq.candidate_id
        join arb.listings l on l.id=c.listing_id
        where oq.status in ('queued','reviewed')
          and not exists (
            select 1 from arb.capital_safety_assessment a
            where a.opportunity_queue_id=oq.id and a.created_at > now() - interval '12 hours'
          )
order by coalesce(oq.priority_score, 0) desc nulls last, oq.created_at asc
        limit $1
        for update skip locked
      )
      update arb.opportunity_queue oq
      set updated_at=now(), reason_json = coalesce(oq.reason_json,'{}'::jsonb) || jsonb_build_object('capitalSafetyClaimedBy',$2::text,'capitalSafetyClaimExpiresAt',(now()+make_interval(secs=>$3::int))::text)
      from claimable c where oq.id=c.id
      returning oq.id as opportunity_queue_id, oq.candidate_id, oq.watchlist_id`,
      [input.batchSize, input.workerId, input.claimTtlSeconds],
      'claimSafetyOpportunities',
    );

    if (r.rows.length === 0) return [];
    const ids = r.rows.map((x) => Number(x.opportunity_queue_id));
        const detail = await this.query(
      `select oq.id as opportunity_queue_id,
              c.id as candidate_id,
              c.listing_id::text,
              c.title as candidate_title,
              coalesce(c.identity_confidence, 0.5)::numeric as identity_confidence,
              coalesce(c.review_required, false) as review_required,
              coalesce(c.is_bundle, false) as is_bundle,
              d.id::text as decision_id,
              coalesce(d.decision::text,'REVIEW') as decision,
              d.estimated_profit_usd,
              d.estimated_roi,
              oq.priority_score,
              d.expected_total_cost_basis_usd,
              pa.decision_code as profit_analysis_decision_code,
              dg.gate_status as dedupe_gate_status,
              m.sold_30d,
              m.active_count,
              m.liquidity_ratio,
              g.grounding_score
       from arb.opportunity_queue oq
       join arb.candidates c on c.id = oq.candidate_id
       left join arb.decisions d on d.listing_id = c.listing_id
       left join arb.profit_analysis pa on pa.candidate_id = c.id
       left join arb.candidate_dedupe_gate dg on dg.candidate_id = c.id
       left join arb.ebay_market m on m.listing_id = c.listing_id
       left join lateral (
         select grounding_score
         from arb.prong2_comp_grounding_assessment x
         where x.candidate_id = c.id
         order by x.created_at desc limit 1
       ) g on true
       where oq.id = any($1::bigint[])`,
      [ids],
      'claimSafetyOpportunities.detail',
    );

    return detail.rows.map((row) => ({
      opportunityQueueId: num(row.opportunity_queue_id, 'opportunity_queue_id'),
      candidateId: num(row.candidate_id, 'candidate_id'),
      listingId: str(row.listing_id, 'listing_id'),
      decisionId: nullableStr(row.decision_id),
      decision: normalizeDecision(row.decision),
      expectedProfitUsd: nullableNum(row.estimated_profit_usd),
      roiPct: nullableNum(row.estimated_roi),
      priorityScore: nullableNum(row.priority_score),
      riskScore: null, // risk_score is not reliably extractable; gate will use safe default
      identityConfidence: nullableNum(row.identity_confidence) ?? 0.5,
      soldCount: nullableNum(row.sold_30d),
      activeCount: nullableNum(row.active_count),
      activeToSoldRatio: nullableNum(row.liquidity_ratio),
      compGroundingScore: nullableNum(row.grounding_score),
      claimToken: input.workerId,
      profitAnalysisDecisionCode: nullableStr(row.profit_analysis_decision_code),
      dedupeGateStatus: nullableStr(row.dedupe_gate_status),
      reviewRequired: Boolean(row.review_required),
      isBundle: Boolean(row.is_bundle),
      candidateTitle: nullableStr(row.candidate_title),
      totalCostBasisUsd: nullableNum(row.expected_total_cost_basis_usd),
    }));
  }

  public async persistSafetyAssessment(input: { decisionInput: SafetyDecisionInput; policy: CapitalSafetyPolicy; result: CapitalSafetyGateResult; replaySignature?: string | null }): Promise<void> {
    const assessmentJson = { decisionInput: input.decisionInput, result: input.result };
    await this.withTransaction('persistSafetyAssessment', async (client) => {
      const outHash = sha256(input.result);
      const inHash = sha256(input.decisionInput);
      const inserted = await client.query(
        `insert into arb.capital_safety_assessment(
          listing_id,candidate_id,opportunity_queue_id,decision_id,policy_version,
          assessment_status,capital_gate_status,replay_status,comp_grounding_status,ledger_status,
          gate_reason_codes,risk_flags,comp_grounding_score,replay_signature,input_hash,output_hash,assessment_json,correlation_id
        ) values($1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11::text[],$12::text[],$13,$14,$15,$16,$17::jsonb,$18::uuid)
        returning id`,
        [
          input.decisionInput.listingId,
          input.decisionInput.candidateId ?? null,
          input.decisionInput.opportunityQueueId ?? null,
          input.decisionInput.decisionId ?? null,
          input.policy.policyVersion,
          input.result.assessmentStatus,
          input.result.capitalGateStatus,
          input.decisionInput.replayStatus ?? 'NOT_RUN',
          (input.decisionInput.compGroundingScore ?? 0) >= input.policy.minCompGroundingScore ? 'PASS' : 'FAIL',
          input.decisionInput.ledgerContinuityOk === false ? 'FAIL' : 'PASS',
          input.result.gateReasonCodes,
          input.result.riskFlags,
          input.decisionInput.compGroundingScore ?? null,
          input.replaySignature ?? null,
          inHash,
          outHash,
          JSON.stringify(assessmentJson),
          input.decisionInput.correlationId,
        ],
      );

            await client.query(
        `update arb.decisions set
           reason_codes = coalesce(reason_codes,'{}'::text[]) || $2::text[],
           reasons_json = case
               when jsonb_typeof(coalesce(reasons_json,'{}'::jsonb)) = 'object'
                 then coalesce(reasons_json,'{}'::jsonb)
               else jsonb_build_object('legacy', coalesce(reasons_json,'[]'::jsonb))
             end
             || jsonb_build_object('capitalSafetyGate', jsonb_build_object(
                  'gateReasonCodes', $3::jsonb,
                  'riskFlags', $4::jsonb,
                  'assessedAt', now()
                )),
           risk_flags_json = case
               when jsonb_typeof(coalesce(risk_flags_json,'[]'::jsonb)) = 'array'
                 then coalesce(risk_flags_json,'[]'::jsonb) || $4::jsonb
               else jsonb_build_array(coalesce(risk_flags_json,'[]'::jsonb)) || $4::jsonb
             end,
           updated_at = now()
         where listing_id=$1::uuid`,
        [
          input.decisionInput.listingId,
          input.result.gateReasonCodes,
          JSON.stringify(input.result.gateReasonCodes),
          JSON.stringify(input.result.riskFlags),
        ],
      );
      if (input.decisionInput.opportunityQueueId) {
        await client.query(`update arb.opportunity_queue set status=$2, updated_at=now() where id=$1`, [
          input.decisionInput.opportunityQueueId,
          input.result.allowedDecision === 'BUY' ? 'reviewed' : 'passed',
        ]);
      }

      await client.query(
        `insert into arb.events_audit(event_type, entity_type, entity_id, payload, actor)
         values('CAPITAL_SAFETY_ASSESSED','listing',$1::uuid,$2::jsonb,'capital-safety')`,
        [input.decisionInput.listingId, JSON.stringify({ assessmentId: inserted.rows[0]?.id, result: input.result })],
      );
    });
  }

  public async insertCompGrounding(input: CompGroundingInput, result: CompGroundingResult): Promise<void> {
    await this.query(
      `insert into arb.prong2_comp_grounding_assessment(
        candidate_id, listing_id, opportunity_queue_id, sold_count, active_count, active_to_sold_ratio,
        identity_confidence,title_fit_score,category_fit_score,condition_fit_score,grounding_score,grounding_status,reason_codes,evidence_json,created_at,updated_at
      ) values($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14::jsonb,now(),now())`,
      [input.candidateId ?? null, input.listingId, input.opportunityQueueId ?? null, input.soldCount, input.activeCount, result.activeToSoldRatio, input.identityConfidence, input.titleFitScore, input.categoryFitScore, input.conditionFitScore, result.groundingScore, result.groundingStatus, result.reasonCodes, JSON.stringify(input.evidenceJson)],
      'insertCompGrounding',
    );
  }

  public async getGroundingCandidates(limit: number): Promise<CompGroundingInput[]> {
    const r = await this.query(
      `select c.id as candidate_id, c.listing_id::text, oq.id as opportunity_queue_id,
              coalesce(m.sold_30d,0) sold_count, coalesce(m.active_count,0) active_count,
              coalesce((c.candidate_confidence)::numeric,0.5) identity_confidence,
              c.title, c.normalized_title, c.brand, c.model, c.source_category_key, m.sold_sample_json, m.active_sample_json
       from arb.candidates c
       left join arb.opportunity_queue oq on oq.candidate_id=c.id
       left join arb.ebay_market m on m.listing_id=c.listing_id
       where not exists(select 1 from arb.prong2_comp_grounding_assessment g where g.candidate_id=c.id and g.created_at > now() - interval '6 hours')
       order by c.updated_at desc
       limit $1`,
      [limit],
      'getGroundingCandidates',
    );
    return r.rows.map((row) => ({
      listingId: str(row.listing_id, 'listing_id'),
      candidateId: num(row.candidate_id, 'candidate_id'),
      opportunityQueueId: nullableNum(row.opportunity_queue_id),
      soldCount: num(row.sold_count, 'sold_count'),
      activeCount: num(row.active_count, 'active_count'),
      identityConfidence: nullableNum(row.identity_confidence) ?? 0.5,
      titleFitScore: computePresenceScore([row.title, row.normalized_title]),
      categoryFitScore: row.source_category_key ? 0.8 : 0.4,
      conditionFitScore: 0.7,
      evidenceJson: { title: row.title, brand: row.brand, model: row.model, soldSample: row.sold_sample_json, activeSample: row.active_sample_json },
    }));
  }

  public async insertDeadLetter(input: { workerName: string; entityType: string; entityId?: string | null; failureCode: string; failureMessage: string; payload?: unknown }): Promise<void> {
    await this.query(
      `insert into arb.capital_safety_dead_letter(worker_name,entity_type,entity_id,failure_code,failure_message,payload,created_at) values($1,$2,$3,$4,left($5,2000),$6::jsonb,now())`,
      [input.workerName, input.entityType, input.entityId ?? null, input.failureCode, input.failureMessage, JSON.stringify(input.payload ?? {})],
      'insertDeadLetter',
    );
  }

    private async query<TRow extends QueryResultRow = QueryResultRow>(sql: string, params: readonly unknown[], operation: string): Promise<QueryResult<TRow>> {
    try { return await this.pool.query<TRow>(sql, [...params] as unknown[]); } catch (error) { this.logger.error('capital safety repository query failed', { operation, error }); throw error; }
  }

  private async withTransaction<T>(operation: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('begin'); const r = await fn(client); await client.query('commit'); return r; }
    catch (error) { try { await client.query('rollback'); } catch {} this.logger.error('capital safety transaction failed', { operation, error }); throw error; }
    finally { client.release(); }
  }
}

function nullableNum(v: unknown): number | null { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function num(v: unknown, field: string): number { const n = nullableNum(v); if (n === null) throw new Error(`Expected number for ${field}`); return n; }
function str(v: unknown, field: string): string { const s = String(v ?? '').trim(); if (!s) throw new Error(`Expected string for ${field}`); return s; }
function nullableStr(v: unknown): string | null { const s = String(v ?? '').trim(); return s ? s : null; }
function normalizeDecision(v: unknown): ClaimedOpportunityForSafety['decision'] { const s = String(v ?? 'REVIEW').toUpperCase(); return ['BUY','WATCH','PASS','REVIEW','REJECT'].includes(s) ? s as ClaimedOpportunityForSafety['decision'] : 'REVIEW'; }
function computePresenceScore(values: unknown[]): number { return values.some((v) => String(v ?? '').trim().length > 4) ? 0.75 : 0.35; }
