import type { Pool } from 'pg';
import type { RequestHandler } from 'express';
import { ObservabilityRepository } from './repositories/observabilityRepository';
import { ObservabilityService,type ObservabilityLogger } from './services/observabilityService';
import { Domain11gMetrics,assertMetricCardinalityContract,getDomain11gMetrics } from './observability/domain11gMetrics';
import { createObservabilityRoutes } from './routes/observabilityRoutes';
import { observabilityErrorMiddleware } from './errors/observabilityErrorMiddleware';

export function createObservabilityModule(input:{
  pool:Pool;logger:ObservabilityLogger;
  auth:{read:RequestHandler;ingest:RequestHandler;admin:RequestHandler};
  metrics?:Domain11gMetrics;
}){
  assertMetricCardinalityContract();
  const repo=new ObservabilityRepository(input.pool);
  const metrics=input.metrics??getDomain11gMetrics();
  const service=new ObservabilityService(repo,input.logger,metrics);
  return {repo,service,metrics,router:createObservabilityRoutes({auth:input.auth,service}),errorMiddleware:observabilityErrorMiddleware};
}
