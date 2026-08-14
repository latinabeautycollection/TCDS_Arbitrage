
import crypto from "node:crypto";
import { Pool } from "pg";
import { IntelligenceJobRepository } from "../repositories/intelligenceJobRepository";
import { IntelligenceDispatcher } from "../intelligence/intelligenceDispatcher";

async function main(): Promise<void> {
  const databaseUrl=process.env.DATABASE_URL;
  const tenantId=process.env.DOMAIN8_SYSTEM_TENANT_ID;
  const actorId=process.env.DOMAIN8_SYSTEM_ACTOR_ID;
  if(!databaseUrl||!tenantId||!actorId) throw new Error("Missing Domain 8 worker configuration");

  const pool=new Pool({connectionString:databaseUrl});
  const repo=new IntelligenceJobRepository(pool);
  const dispatcher=new IntelligenceDispatcher();
  const workerId=process.env.DOMAIN8_8F_WORKER_ID??`domain8-8f-${process.pid}`;
  const leaseSeconds=300;
  let stopped=false;
  const stop=async()=>{stopped=true;await pool.end();};
  process.on("SIGTERM",()=>void stop());
  process.on("SIGINT",()=>void stop());

  while(!stopped){
    const context={tenantId,actorId,correlationId:crypto.randomUUID()};
    const jobs=await repo.claim(context,workerId,25,leaseSeconds);
    for(const job of jobs){
      const heartbeat=setInterval(()=>{
        void repo.heartbeat(context,job,leaseSeconds);
      },60000);
      try{
        await repo.start(context,job,workerId);
        const result=await repo.transaction(context,client=>dispatcher.dispatch(client,job));
        await repo.transaction(context, async client => {
          await client.query(
            "select return_defense.complete_intelligence_job_atomic($1::uuid,$2::uuid,$3,$4,$5::jsonb)",
            [job.intelligence_job_id,job.claim_token,workerId,"8F.1.2",JSON.stringify(result)],
          );
        });
      }catch(error){
        const code=typeof error==="object"&&error!==null&&"code" in error
          ?String((error as {code?:unknown}).code??"UNKNOWN"):"UNKNOWN";
        await repo.fail(context,job,code,error instanceof Error?error.message:String(error),
          ["40001","40P01","55P03","57014","08006"].includes(code));
      }finally{clearInterval(heartbeat);}
    }
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
}
void main().catch(()=>{process.exitCode=1;});
