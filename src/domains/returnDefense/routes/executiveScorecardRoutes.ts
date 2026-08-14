
import { Router } from "express";
import type { Pool } from "pg";
import { requireIntelligenceContext,type TrustedIntelligenceRequest } from "../security/trustedIntelligenceContext";
export function buildExecutiveScorecardRoutes(pool:Pool):Router{
 const router=Router();
 router.get("/domain8/executive-scorecards/current",async(req:TrustedIntelligenceRequest,res,next)=>{
  try{
   const ctx=requireIntelligenceContext(req,["DOMAIN8_EXECUTIVE","DOMAIN8_AUDITOR"]);
   const client=await pool.connect();
   try{
    await client.query("BEGIN");
    await client.query("select set_config('app.tenant_id',$1,true)",[ctx.tenantId]);
    const result=await client.query("select * from return_defense.v_executive_current_loss_position");
    await client.query("COMMIT");res.json({ok:true,data:result.rows});
   }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }catch(error){next(error);}
 });
 return router;
}
