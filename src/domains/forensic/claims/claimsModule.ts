import type{Pool}from'pg';import{ClaimsRepository}from'./repositories/claimsRepository';
import{ArbProcessRunAdapter}from'./adapters/arbProcessRunAdapter';import{ClaimsService}from'./services/claimsService';
import{createClaimsRouter}from'./routes/claimsRoutes';
export function createClaimsModule(pool:Pool){const repo=new ClaimsRepository(pool);const runs=new ArbProcessRunAdapter(pool);
const service=new ClaimsService(repo,runs);return{service,router:createClaimsRouter(service)}}
