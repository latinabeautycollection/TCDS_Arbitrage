import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FinancialState } from '../models/capitalSafetyTypes';

export interface CapitalStateProvider{
  load(client:PoolClient,runId:number,currencyCode:string):Promise<FinancialState>;
}

export class Domain2CapitalStateProvider implements CapitalStateProvider{
  async load(client:PoolClient,runId:number,currencyCode:string):Promise<FinancialState>{
    const view=await client.query<{exists:boolean}>(`select to_regclass('arb.v_domain2_financial_state') is not null as exists`);
    if(view.rows[0]?.exists){
      const r=await client.query(`select * from arb.v_domain2_financial_state where capital_allocation_run_id=$1 and currency_code=$2 limit 1`,[runId,currencyCode]);
      if(r.rowCount===1){
        const x=r.rows[0] as Record<string,unknown>;
        return stateFromRow(x,'COMPLETE',`arb.v_domain2_financial_state:${runId}`);
      }
    }
    const r=await client.query(`select id,total_capital_usd,reserve_usd,deployable_capital_usd,allocated_capital_usd,remaining_capital_usd,completed_at
      from arb.capital_allocation_runs where id=$1 and run_status='completed'`,[runId]);
    if(r.rowCount!==1)return unavailable(currencyCode,`arb.capital_allocation_runs:${runId}`);
    const x=r.rows[0] as Record<string,unknown>;
    const observedAt=new Date(String(x.completed_at));
    const available=num(x.remaining_capital_usd);
    const payload={runId,totalCapital:num(x.total_capital_usd),reserve:num(x.reserve_usd),deployable:num(x.deployable_capital_usd),
      allocated:num(x.allocated_capital_usd),remaining:available,observedAt:observedAt.toISOString()};
    return {
      sourceReference:`arb.capital_allocation_runs:${runId}`,
      observedAt,completeness:'PARTIAL',currencyCode,
      ledgerBalance:null,reservedCapital:null,committedCapital:null,pendingPurchaseExposure:null,
      settledPurchaseExposure:null,authoritativeCapitalAtRisk:null,authoritativeDailyCapitalAtRisk:null,unreconciledTransactions:null,availableToDeploy:available,
      domain2RemainingCapitalUsd:available,sourceHash:sha(payload)
    };
  }
}
function stateFromRow(x:Record<string,unknown>,completeness:'COMPLETE',ref:string):FinancialState{
  const observedAt=new Date(String(x.observed_at??x.completed_at??new Date().toISOString()));
  const currencyCode=String(x.currency_code??'USD').toUpperCase();
  const payload={...x};
  return {sourceReference:ref,observedAt,completeness,currencyCode,
    ledgerBalance:nullable(x.ledger_balance),reservedCapital:nullable(x.reserved_capital),
    committedCapital:nullable(x.committed_capital),pendingPurchaseExposure:nullable(x.pending_purchase_exposure),
    settledPurchaseExposure:nullable(x.settled_purchase_exposure),authoritativeCapitalAtRisk:nullable(x.capital_at_risk),authoritativeDailyCapitalAtRisk:nullable(x.daily_capital_at_risk),unreconciledTransactions:nullable(x.unreconciled_transactions),
    availableToDeploy:nullable(x.available_to_deploy),domain2RemainingCapitalUsd:nullable(x.domain2_remaining_capital_usd),
    sourceHash:sha(payload)};
}
function unavailable(currencyCode:string,ref:string):FinancialState{return {sourceReference:ref,observedAt:new Date(0),completeness:'UNAVAILABLE',currencyCode,
  ledgerBalance:null,reservedCapital:null,committedCapital:null,pendingPurchaseExposure:null,settledPurchaseExposure:null,authoritativeCapitalAtRisk:null,authoritativeDailyCapitalAtRisk:null,
  unreconciledTransactions:null,availableToDeploy:null,domain2RemainingCapitalUsd:null,sourceHash:sha({ref,status:'UNAVAILABLE'})};}
function nullable(v:unknown):number|null{const n=Number(v);return Number.isFinite(n)?n:null;}
function num(v:unknown):number{return nullable(v)??0;}
function sha(v:unknown):string{return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');}
