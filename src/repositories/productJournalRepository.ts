import { PoolClient } from 'pg';

export class ProductJournalRepository {
  constructor(private readonly client: PoolClient) {}

  async append(input: {
    entityType: string;
    entityPk: string;
    listingId?: string | null;
    candidateId?: number | null;
    watchlistId?: number | null;
    sourceListingNormalizedId?: number | null;
    eventType: string;
    processName: string;
    processStage?: string | null;
    processRunId?: string | null;
    correlationId?: string | null;
    actorType: 'user' | 'worker' | 'system' | 'api' | 'service_account';
    actorId?: string | null;
    actorName?: string | null;
    workerName?: string | null;
    workerInstanceId?: string | null;
    codeVersion?: string | null;
    rulesetVersion?: string | null;
    modelVersion?: string | null;
    decisionCode?: string | null;
    reasonCodes?: string[];
    riskFlags?: string[];
    eventSummary: string;
    eventDetailsJson?: Record<string, unknown>;
  }) {
    await this.client.query(
      `
      insert into arb.product_journal (
        entity_type,
        entity_pk,
        listing_id,
        candidate_id,
        watchlist_id,
        source_listing_normalized_id,
        event_type,
        process_name,
        process_stage,
        process_run_id,
        correlation_id,
        actor_type,
        actor_id,
        actor_name,
        worker_name,
        worker_instance_id,
        code_version,
        ruleset_version,
        model_version,
        decision_code,
        reason_codes,
        risk_flags,
        event_summary,
        event_details_json
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb
      )
      `,
      [
        input.entityType,
        input.entityPk,
        input.listingId ?? null,
        input.candidateId ?? null,
        input.watchlistId ?? null,
        input.sourceListingNormalizedId ?? null,
        input.eventType,
        input.processName,
        input.processStage ?? null,
        input.processRunId ?? null,
        input.correlationId ?? null,
        input.actorType,
        input.actorId ?? null,
        input.actorName ?? null,
        input.workerName ?? null,
        input.workerInstanceId ?? null,
        input.codeVersion ?? null,
        input.rulesetVersion ?? null,
        input.modelVersion ?? null,
        input.decisionCode ?? null,
        input.reasonCodes ?? [],
        input.riskFlags ?? [],
        input.eventSummary,
        JSON.stringify(input.eventDetailsJson ?? {})
      ]
    );
  }
}
