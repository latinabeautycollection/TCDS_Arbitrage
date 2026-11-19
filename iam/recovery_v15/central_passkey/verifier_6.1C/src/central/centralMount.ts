import {Pool} from 'pg';
import type {Express} from 'express';
import {env} from '../config/env';
import {readCentralConfig} from './centralConfig';
import {centralRoutes,centralWorkloadAuth} from './centralRoutes';
import {readGrantConfig} from './centralGrants';

/** Mounts the central issuer passkey routes when CENTRAL_* is configured; otherwise the verifier is unchanged. */
export function mountCentral(app:Express,e:NodeJS.ProcessEnv=process.env){
  const cfg=readCentralConfig(e,env);
  if(!cfg)return null;
  const grants=readGrantConfig(e);
  const db=new Pool({connectionString:cfg.CENTRAL_DATABASE_URL,max:4});
  app.get('/ready/central',async(_q,r)=>{
    try{await db.query('select 1');r.json({status:'ready',rpId:cfg.CENTRAL_RP_ID,origin:cfg.CENTRAL_ORIGIN,...(grants?{grantApproval:true}:{})})}
    catch{r.status(503).json({status:'not_ready'})}
  });
  app.use('/internal/v1/central',centralWorkloadAuth(db,cfg),centralRoutes(db,cfg,grants));
  return {rpId:cfg.CENTRAL_RP_ID};
}
