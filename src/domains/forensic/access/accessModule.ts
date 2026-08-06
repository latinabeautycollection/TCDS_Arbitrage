import type{Pool}from'pg';import{AccessRepository}from'./repositories/accessRepository';import{BreakGlassRepository}from'./repositories/breakGlassRepository';
import{ProtectedEvidenceAccessService}from'./services/protectedEvidenceAccessService';import{BreakGlassService}from'./services/breakGlassService';
import{ArbExecutionAdapter}from'./adapters/arbExecutionAdapter';import{createAccessRoutes}from'./routes/accessRoutes';
import{AccessReadinessProbe}from'./readiness/accessReadinessProbe';
export function createDomain7H1Module(pool:Pool){const exec=new ArbExecutionAdapter(pool),accessRepo=new AccessRepository(pool);
 const breakRepo=new BreakGlassRepository(pool),breakService=new BreakGlassService(breakRepo,exec);
 return{protectedAccess:new ProtectedEvidenceAccessService(accessRepo),breakGlass:breakService,
  router:createAccessRoutes(breakService),readiness:new AccessReadinessProbe(pool),execution:exec}}
