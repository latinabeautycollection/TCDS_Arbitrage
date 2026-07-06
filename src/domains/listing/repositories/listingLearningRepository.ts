import { Pool } from 'pg';
import { getPool } from './db';
import { LearningSignal } from '../learning/closedLoopLearningEngine';

export class ListingLearningRepository {
  constructor(private readonly db: Pool = getPool()) {}
  async writeSignals(input: { ebayListingFk: number; sourceListingNormalizedId?: number; signals: LearningSignal[]; processRunId?: string }): Promise<void> {
    for (const signal of input.signals) {
      await this.db.query(`
        insert into arb.listing_learning_signal(ebay_listing_fk, source_listing_normalized_id, signal_name, signal_value, interpretation, process_run_id)
        values ($1,$2,$3,$4,$5,$6)
      `, [input.ebayListingFk, input.sourceListingNormalizedId ?? null, signal.signalName, signal.value, signal.interpretation, input.processRunId ?? null]);
    }
  }
}
