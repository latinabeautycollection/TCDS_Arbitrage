import express from 'express';
import request from 'supertest';
import { accountabilityErrorMiddleware } from '../../domains/governance/errors/accountabilityErrorMiddleware';
import { createAccountabilityRoutes, type AccountabilityRouteAuth } from '../../domains/governance/routes/accountabilityRoutes';

const allow:any=(req:any,res:any,next:any)=>{res.locals.accountabilityPrincipal={reference:'u',authSessionId:'123e4567-e89b-42d3-a456-426614174000',permissions:['governance.lineage.read','governance.lineage.write','governance.lineage.admin']};next();};
const auth:AccountabilityRouteAuth={read:allow,mutationWrite:allow,auditWrite:allow,lineageWrite:allow,externalReport:allow,admin:allow};

function appWith(repoOverrides:Record<string,unknown>={}){
  const repo:any={
    walk:async()=>[],correlation:async()=>[],timeline:async()=>[],transaction:async()=>[],
    request:async()=>[],policy:async()=>[],external:async()=>[],verify:async()=>({valid:true}),
    ...repoOverrides
  };
  const service:any={
    accessAudit:async()=>undefined,
    revokeSourceAuthority:async()=> '123e4567-e89b-42d3-a456-426614174001',
    edge:async()=>{throw Object.assign(new Error('lineage_conflict'),{code:'23514'});}
  };
  const app=express();app.use(express.json());app.use(createAccountabilityRoutes({auth,service,repo}));app.use(accountabilityErrorMiddleware);return app;
}

describe('Domain11E HTTP error contract',()=>{
  test('malformed UUID -> 400',async()=>{await request(appWith()).get('/governance/lineage/correlation/bananas').expect(400);});
  test('lineage constraint conflict -> 409',async()=>{await request(appWith()).post('/governance/lineage/edges').send({
    source:{domainCode:'DOMAIN_1',entityType:'ORDER',entityId:'1'},
    relationshipType:'CAUSED',
    target:{domainCode:'DOMAIN_2',entityType:'ACTION',entityId:'2'},
    referenceMetadata:{},idempotencyKey:'x'
  }).expect(409);});
  test('permission failure -> 403',async()=>{
    const deny:any=(_req:any,res:any)=>res.status(403).json({error:'GOVERNANCE_PERMISSION_DENIED'});
    const app=express();app.use(express.json());app.use(createAccountabilityRoutes({auth:{...auth,read:deny},service:{} as any,repo:{} as any}));app.use(accountabilityErrorMiddleware);
    await request(app).get('/governance/lineage/correlation/123e4567-e89b-42d3-a456-426614174000').expect(403);
  });
  test('unexpected repository error -> 500',async()=>{await request(appWith({correlation:async()=>{throw new Error('boom');}})).get('/governance/lineage/correlation/123e4567-e89b-42d3-a456-426614174000').expect(500);});
});
