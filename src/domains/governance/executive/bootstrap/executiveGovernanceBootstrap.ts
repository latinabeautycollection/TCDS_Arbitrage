import type { Express,RequestHandler } from 'express'; import type { Pool } from 'pg'; import type { Registry } from 'prom-client';
import { ExecutiveGovernanceRepository } from '../repositories/executiveGovernanceRepository'; import { Phase3CertificationRepository } from '../repositories/phase3CertificationRepository';
import { ExecutiveGovernanceService } from '../services/executiveGovernanceService'; import { Phase3CertificationService } from '../services/phase3CertificationService';
import { createExecutiveGovernanceRouter } from '../routes/executiveGovernanceRoutes'; import type { TrustedPrincipalResolver } from '../auth/executiveAuthorization'; import { ExecutiveMetrics } from '../observability/executiveMetrics';
export interface ExecutiveLogger { info(message:string,bindings?:Record<string,unknown>):void; error(message:string,bindings?:Record<string,unknown>):void; }
export function mountDomain11L(app:Express,d:{pool:Pool;principalResolver:TrustedPrincipalResolver;registry:Registry;logger:ExecutiveLogger;errorHandler?:RequestHandler}){
 const gr=new ExecutiveGovernanceRepository(d.pool);const cr=new Phase3CertificationRepository(d.pool);new ExecutiveMetrics(d.registry);
 app.use('/governance/executive',createExecutiveGovernanceRouter({governance:new ExecutiveGovernanceService(gr),certification:new Phase3CertificationService(cr),principalResolver:d.principalResolver}));
 d.logger.info('Domain 11L executive governance routes mounted',{operation:'domain11l.mount'});
}
