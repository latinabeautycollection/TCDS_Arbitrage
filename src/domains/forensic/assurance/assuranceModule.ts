import type{Pool}from'pg';import{AssuranceRepository}from'./repositories/assuranceRepository';
import{ArbProcessRunAdapter}from'./adapters/arbProcessRunAdapter';import{AssuranceService}from'./services/assuranceService';
import{createAssuranceRouter}from'./routes/assuranceRoutes';
export function createAssuranceModule(pool:Pool){const repo=new AssuranceRepository(pool);const runs=new ArbProcessRunAdapter(pool);
const service=new AssuranceService(repo,runs);return{service,router:createAssuranceRouter(service)}}
