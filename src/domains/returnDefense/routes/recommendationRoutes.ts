
import { Router } from "express";
import type { Pool } from "pg";
import { requireIntelligenceContext,type TrustedIntelligenceRequest } from "../security/trustedIntelligenceContext";
export function buildRecommendationRoutes(pool:Pool):Router{
 const router=Router();
 router.post("/domain8/recommendations/:id/submit",async(req:TrustedIntelligenceRequest,res,next)=>{
  try{
   const ctx=requireIntelligenceContext(req,["DOMAIN8_REVIEWER"]);
   const client=await pool.connect();
   try{
    await client.query("BEGIN");
    await client.query("select set_config('app.tenant_id',$1,true)",[ctx.tenantId]);
    await client.query("select set_config('app.actor_id',$1,true)",[ctx.actorId]);
    await client.query("select set_config('app.correlation_id',$1,true)",[ctx.correlationId]);
    await client.query("select return_defense.submit_policy_recommendation($1::uuid)",[req.params.id]);
    await client.query("COMMIT");res.json({ok:true});
   }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }catch(error){next(error);}
 });
 return router;
}
