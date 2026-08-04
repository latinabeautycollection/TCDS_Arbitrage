import type{Pool}from'pg';import{LegalHoldRepository}from'./repositories/legalHoldRepository';
import{ArbProcessRunAdapter}from'./adapters/arbProcessRunAdapter';import{LegalHoldService}from'./services/legalHoldService';
import{createLegalHoldRouter}from'./routes/legalHoldRoutes';
export function createLegalHoldModule(pool:Pool){const repo=new LegalHoldRepository(pool);const runs=new ArbProcessRunAdapter(pool);
const service=new LegalHoldService(repo,runs);return{service,router:createLegalHoldRouter(service)}}
