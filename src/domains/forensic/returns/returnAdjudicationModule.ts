import type { Pool } from 'pg';
import { ReturnAdjudicationRepository } from './repositories/returnAdjudicationRepository';
import { ArbProcessRunAdapter } from './adapters/arbProcessRunAdapter';
import { ReturnAdjudicationService } from './services/returnAdjudicationService';
import { createReturnAdjudicationRouter } from './routes/returnAdjudicationRoutes';
export function createReturnAdjudicationModule(pool:Pool){
 const repository=new ReturnAdjudicationRepository(pool);
 const processRuns=new ArbProcessRunAdapter(pool);
 const service=new ReturnAdjudicationService(repository,processRuns);
 return{service,router:createReturnAdjudicationRouter(service)};
}
