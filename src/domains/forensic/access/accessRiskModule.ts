import type{Pool}from'pg';import{AccessRiskRepository}from'./repositories/accessRiskRepository';import{AccessRiskService}from'./services/accessRiskService';
import{ArbExecutionAdapter}from'./adapters/arbExecutionAdapter';import{createAccessRiskRoutes}from'./routes/accessRiskRoutes';
export function createDomain7H2Module(pool:Pool){const service=new AccessRiskService(new AccessRiskRepository(pool),new ArbExecutionAdapter(pool));
 return{service,router:createAccessRiskRoutes(service)}}
