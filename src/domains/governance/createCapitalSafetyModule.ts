import type { Pool } from 'pg';
import type { RequestHandler } from 'express';
import { CapitalSafetyRepository } from './repositories/capitalSafetyRepository';
import { Domain2CapitalStateProvider,type CapitalStateProvider } from './providers/domain2CapitalStateProvider';
import { CapitalSafetyService } from './services/capitalSafetyService';
import { createCapitalSafetyRoutes } from './routes/capitalSafetyRoutes';
import { capitalSafetyErrorMiddleware } from './errors/capitalSafetyErrorMiddleware';
import type { CapitalSafetyLogger,CapitalSafetyMetrics } from './observability/capitalSafetyObservability';
import { noopCapitalSafetyMetrics } from './observability/capitalSafetyObservability';

export function createCapitalSafetyModule(input:{
  pool:Pool;
  logger:CapitalSafetyLogger;
  metrics?:CapitalSafetyMetrics;
  financialProvider?:CapitalStateProvider;
  auth:{read:RequestHandler;assess:RequestHandler;admin:RequestHandler};
}){
  const repo=new CapitalSafetyRepository(input.pool);
  const service=new CapitalSafetyService(repo,input.financialProvider??new Domain2CapitalStateProvider(),input.logger,input.metrics??noopCapitalSafetyMetrics);
  const router=createCapitalSafetyRoutes({auth:input.auth,service});
  return {repo,service,router,errorMiddleware:capitalSafetyErrorMiddleware};
}
