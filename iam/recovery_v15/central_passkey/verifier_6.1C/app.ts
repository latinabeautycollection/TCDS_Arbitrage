import express from 'express';
import crypto from 'node:crypto';
import {env} from './config/env';
import {webauthnRoutes,deviceProofRoutes} from './http/routes';
import {orchestratorDb,webauthnDb,deviceDb} from './db/pool';
import {mountCentral} from './central/centralMount';

function auth(scope:'webauthn'|'device'){
  return async(req:any,res:any,next:any)=>{
    try{
      const raw=JSON.stringify(req.body??{});
      const hash=crypto.createHash('sha256').update(raw).digest('hex');
      const secret=scope==='webauthn'
        ?env.WEBAUTHN_WORKLOAD_SECRET
        :env.DEVICE_WORKLOAD_SECRET;
      const ts=req.get('x-tcds-timestamp');
      const nonce=req.get('x-tcds-nonce');
      const rid=req.get('x-request-id');
      const cid=req.get('x-correlation-id');
      const suppliedHash=req.get('x-tcds-body-sha256');
      const sig=req.get('x-tcds-request-signature');

      if(!ts||!nonce||!rid||!cid||!sig||!suppliedHash
        ||Math.abs(Date.now()-Number(ts))>60_000
        ||req.get('x-tcds-workload')!==scope
        ||suppliedHash!==hash){
        return res.status(401).json({error:{code:'WORKLOAD_AUTH_FAILED'}});
      }

      const expected=crypto.createHmac('sha256',secret)
        .update(`${ts}.${nonce}.${hash}.${rid}`)
        .digest('base64url');

      const eb=Buffer.from(expected);
      const sb=Buffer.from(sig);
      if(eb.length!==sb.length||!crypto.timingSafeEqual(eb,sb)){
        return res.status(401).json({error:{code:'WORKLOAD_AUTH_FAILED'}});
      }

      const db=scope==='webauthn'?webauthnDb:deviceDb;
      const nonceHash=crypto.createHash('sha256').update(nonce).digest();
      const q=await db.query(
        `SELECT warehouse_identity.claim_verifier_workload_nonce_v1(
          $1,$2,$3,$4,clock_timestamp()+interval '70 seconds'
        ) claimed`,
        [scope,nonceHash,rid,cid]
      );
      if(q.rows[0]?.claimed!==true){
        return res.status(409).json({error:{code:'WORKLOAD_REPLAY_REJECTED'}});
      }

      return next();
    }catch{
      return res.status(503).json({error:{code:'WORKLOAD_SECURITY_DEPENDENCY_UNAVAILABLE'}});
    }
  };
}

export function buildApp(){
  const app=express();

  // Parser is installed exactly once before workload authentication.
  app.use(express.json({limit:'256kb'}));

  app.get('/health',(_q,r)=>r.json({status:'ok'}));

  app.get('/ready',async(_q,r)=>{
    try{
      await Promise.all([
        orchestratorDb.query('select 1'),
        webauthnDb.query('select 1'),
        deviceDb.query('select 1')
      ]);
      r.json({
        status:'ready',database:true,roles:true,
        rpId:env.RP_ID,origin:env.EXPECTED_ORIGIN
      });
    }catch{
      r.status(503).json({status:'not_ready'});
    }
  });

  // Strict router isolation: no WebAuthn endpoints exist under the device scope.
  app.use('/internal/v1/webauthn',auth('webauthn'),webauthnRoutes());
  app.use('/internal/v1/device-proof',auth('device'),deviceProofRoutes());
  // Central issuer passkey ceremony (TCDS 626): only when CENTRAL_* is configured; own secret, scope and DB role.
  mountCentral(app);

  return app;
}
