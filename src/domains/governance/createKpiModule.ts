import type { Pool } from 'pg';
import type { RequestHandler } from 'express';
import { KpiRepository } from './repositories/kpiRepository';
import { KpiService } from './services/kpiService';
import { createKpiRoutes } from './routes/kpiRoutes';
import { kpiErrorMiddleware } from './errors/kpiErrorMiddleware';
import { getDomain11hMetrics,type KpiLogger } from './observability/kpiObservability';
export function createKpiModule(input:{pool:Pool;logger:KpiLogger;auth:{read:RequestHandler;calculate:RequestHandler;admin:RequestHandler}}){
 const repo=new KpiRepository(input.pool);const metrics=getDomain11hMetrics();const service=new KpiService(repo,input.logger,metrics);
 return {repo,service,metrics,router:createKpiRoutes({auth:input.auth,service}),errorMiddleware:kpiErrorMiddleware};
}
