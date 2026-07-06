import { Pool } from 'pg';
import { getPool } from '../repositories/db';

export type KnowledgeEdgeType = 'SOURCED_AS' | 'NORMALIZED_TO' | 'MATCHED_TO_CATALOG' | 'LISTED_AS' | 'SOLD_AS' | 'SHIPPED_BY' | 'RETURNED_AS' | 'DISPUTED_AS' | 'LEARNED_SIGNAL';

export class ListingKnowledgeGraphService {
  constructor(private readonly db: Pool = getPool()) {}
  async addEdge(input: { fromType: string; fromPk: string; toType: string; toPk: string; edgeType: KnowledgeEdgeType; evidence?: Record<string, unknown>; processRunId?: string }): Promise<void> {
    await this.db.query(`
      insert into arb.listing_knowledge_edges(from_entity_type, from_entity_pk, to_entity_type, to_entity_pk, edge_type, evidence_json, process_run_id)
      values ($1,$2,$3,$4,$5,$6,$7)
      on conflict(from_entity_type, from_entity_pk, to_entity_type, to_entity_pk, edge_type) do update set evidence_json = excluded.evidence_json, updated_at=now()
    `, [input.fromType, input.fromPk, input.toType, input.toPk, input.edgeType, input.evidence ?? {}, input.processRunId ?? null]);
  }
}
