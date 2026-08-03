import type { Pool } from 'pg';
import { ReturnIntakeRepository } from './repositories/returnIntakeRepository';
import { ArbProcessRunAdapter } from './adapters/arbProcessRunAdapter';
import { ReturnIntakeService } from './services/returnIntakeService';
import { createReturnIntakeRouter } from './routes/returnIntakeRoutes';
import { returnIntakeReadiness } from './observability/returnIntakeReadiness';

export function createReturnIntakeModule(pool:Pool){
 const repository=new ReturnIntakeRepository(pool);
 const processRuns=new ArbProcessRunAdapter(pool);
 const service=new ReturnIntakeService(repository,processRuns);
 return {service,router:createReturnIntakeRouter(service),readiness:()=>returnIntakeReadiness(pool)};
}
