
import { Router } from "express";
import type { Pool } from "pg";
import { outcomeObservationSchema } from "../validators/intelligenceValidator";
import { requireIntelligenceContext,type TrustedIntelligenceRequest } from "../security/trustedIntelligenceContext";

export function buildIntelligenceRoutes(pool:Pool):Router{
 const router=Router();
 router.post("/domain8/intelligence/outcomes",async(req:TrustedIntelligenceRequest,res,next)=>{
  try{
   const input=outcomeObservationSchema.parse(req.body);
   const ctx=requireIntelligenceContext(req,["DOMAIN8_RUNTIME","DOMAIN8_REVIEWER"]);
   const client=await pool.connect();
   try{
    await client.query("BEGIN");
    await client.query("select set_config('app.tenant_id',$1,true)",[ctx.tenantId]);
    await client.query("select set_config('app.actor_id',$1,true)",[ctx.actorId]);
    await client.query("select set_config('app.correlation_id',$1,true)",[ctx.correlationId]);
    const result=await client.query<{id:string}>(
     `select return_defense.record_outcome_observation_v2(
       $1::uuid,$2,$3::timestamptz,NULL,NULL,NULL,NULL,NULL,NULL,$4,$5::jsonb
      ) id`,
     [input.passportId,input.outcomeType,input.observedAt,input.idempotencyKey,JSON.stringify(input.payload)],
    );
    await client.query("COMMIT");
    res.status(201).json({ok:true,outcomeObservationId:result.rows[0]!.id});
   }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }catch(error){next(error);}
 });
 return router;
}
