import type{Pool}from'pg';import{RecoveryRepository}from'./repositories/recoveryRepository';
import{ArbProcessRunAdapter}from'./adapters/arbProcessRunAdapter';import{RecoveryService}from'./services/recoveryService';
import{createRecoveryRouter}from'./routes/recoveryRoutes';
export function createRecoveryModule(pool:Pool){const repo=new RecoveryRepository(pool);const runs=new ArbProcessRunAdapter(pool);
const service=new RecoveryService(repo,runs);return{service,router:createRecoveryRouter(service)}}
