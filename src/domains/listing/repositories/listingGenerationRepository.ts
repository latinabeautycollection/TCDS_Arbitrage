import { getPool } from './db';
export class ListingGenerationRepository {
  async startRun(input:{sourceListingNormalizedId:number; arbitrageDecisionId?:number|null; processRunId?:string|null; snapshot:unknown;}): Promise<number> {
    const { rows } = await getPool().query(`INSERT INTO arb.listing_ai_generation_runs (source_listing_normalized_id, arbitrage_decision_id, process_run_id, input_snapshot_json) VALUES ($1,$2,$3,$4) RETURNING id`, [input.sourceListingNormalizedId,input.arbitrageDecisionId||null,input.processRunId||null,JSON.stringify(input.snapshot)]);
    return Number(rows[0].id);
  }
  async finishRun(id:number, status:string, draftId:number|null, summary:unknown, riskFlags:string[], costUsd=0): Promise<void> {
    await getPool().query(`UPDATE arb.listing_ai_generation_runs SET run_status=$2, ebay_listing_draft_id=$3, output_summary_json=$4, risk_flags_json=$5, cost_usd=$6, completed_at=now() WHERE id=$1`, [id,status,draftId,JSON.stringify(summary),JSON.stringify(riskFlags),costUsd]);
  }
  async recordModelOutput(runId:number, output:{provider:string; model?:string; taskName:string; output:unknown; confidenceScore?:number; riskFlags?:string[]; tokensInput?:number; tokensOutput?:number; costUsd?:number; latencyMs?:number; success?:boolean; errorMessage?:string;}): Promise<void> {
    await getPool().query(`INSERT INTO arb.listing_ai_model_outputs (generation_run_id, provider, model_name, task_name, output_json, confidence_score, risk_flags_json, tokens_input, tokens_output, cost_usd, latency_ms, success, error_message) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [runId,output.provider,output.model||null,output.taskName,JSON.stringify(output.output),output.confidenceScore||null,JSON.stringify(output.riskFlags||[]),output.tokensInput||null,output.tokensOutput||null,output.costUsd||0,output.latencyMs||null,output.success ?? true,output.errorMessage||null]);
  }
}
