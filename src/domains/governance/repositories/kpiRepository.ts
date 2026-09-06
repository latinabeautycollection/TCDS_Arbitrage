import type {Pool} from 'pg';
import type {CalculateMetricRequest,KpiSnapshot} from '../models/kpiTypes';

export class KpiRepository {
  constructor(private readonly pool: Pool) {}

  async componentId(code:'DOMAIN11H_KPI_ENGINE'|'DOMAIN11H_KPI_WORKER'): Promise<string> {
    const q=await this.pool.query<{component_id:string}>(
      `select component_id from arb.component_registry where component_code=$1 and active`,[code]);
    if(q.rowCount!==1) throw new Error(`DOMAIN11H_COMPONENT_MISSING:${code}`);
    return q.rows[0]!.component_id;
  }

  async publishUser(input:{req:CalculateMetricRequest;componentId:string;authSessionId:string;requestId:string;correlationId:string}):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11h_publish_snapshot_user_v3(
        $1,$2,$3,$4::jsonb,$5::char(3),$6::uuid,$7::uuid,$8::uuid,$9::uuid,$10,$11
      ) id`,[
      input.req.metricCode,input.req.window.from,input.req.window.to,JSON.stringify(input.req.dimensions),input.req.currencyCode??null,
      input.componentId,input.authSessionId,input.requestId,input.correlationId,input.req.idempotencyKey,input.req.restatementReason??null
    ]);
    return q.rows[0]!.id;
  }

  async publishService(input:{req:CalculateMetricRequest;componentId:string;requestId:string;correlationId:string}):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11h_publish_snapshot_service_v3(
        $1,$2,$3,$4::jsonb,$5::char(3),$6::uuid,$7::uuid,$8::uuid,$9,$10
      ) id`,[
      input.req.metricCode,input.req.window.from,input.req.window.to,JSON.stringify(input.req.dimensions),input.req.currencyCode??null,
      input.componentId,input.requestId,input.correlationId,input.req.idempotencyKey,input.req.restatementReason??null
    ]);
    return q.rows[0]!.id;
  }

  async finalizeUser(input:{snapshotId:string;componentId:string;authSessionId:string;requestId:string;correlationId:string;reason:string}):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11h_finalize_snapshot_user_v3($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6) id`,
      [input.snapshotId,input.componentId,input.authSessionId,input.requestId,input.correlationId,input.reason]);
    return q.rows[0]!.id;
  }

  async finalizeService(input:{snapshotId:string;componentId:string;requestId:string;correlationId:string;reason:string}):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11h_finalize_snapshot_service_v3($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5) id`,
      [input.snapshotId,input.componentId,input.requestId,input.correlationId,input.reason]);
    return q.rows[0]!.id;
  }

  async verify(snapshotId:string):Promise<Record<string,unknown>>{
    const q=await this.pool.query<{result:Record<string,unknown>}>(
      `select arb.domain11h_verify_snapshot_v3($1::uuid) result`,[snapshotId]);
    return q.rows[0]!.result;
  }

  async getSnapshot(id:string):Promise<KpiSnapshot|null>{
    const q=await this.pool.query<KpiSnapshot>(
      `select * from arb.v_domain11h_metric_snapshots where metric_snapshot_id=$1::uuid`,[id]);
    return q.rows[0]??null;
  }

  async recent(code:string,limit:number):Promise<KpiSnapshot[]>{
    return (await this.pool.query<KpiSnapshot>(
      `select * from arb.v_domain11h_metric_snapshots where metric_code=$1 order by generated_at desc limit $2`,
      [code,limit])).rows;
  }
}
