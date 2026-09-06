import express from 'express';import request from 'supertest';
import { createCapitalSafetyRoutes,type CapitalSafetyRouteAuth } from '../../domains/governance/routes/capitalSafetyRoutes';
import { capitalSafetyErrorMiddleware } from '../../domains/governance/errors/capitalSafetyErrorMiddleware';
const allow:any=(_req:any,res:any,next:any)=>{res.locals.capitalSafetyPrincipal={reference:'u',authSessionId:'123e4567-e89b-42d3-a456-426614174000',permissions:['governance.capital-safety.read','governance.capital-safety.assess']};next();};
const auth:CapitalSafetyRouteAuth={read:allow,assess:allow,admin:allow};
describe('Domain11F route contract',()=>{
  test('namespaced and malformed request is 400',async()=>{const app=express();app.use(express.json());app.use(createCapitalSafetyRoutes({auth,service:{} as any}));app.use(capitalSafetyErrorMiddleware);await request(app).post('/governance/capital-safety/assess').send({}).expect(400);});
  test('current endpoint is namespaced',async()=>{const service:any={current:async()=>({assessmentState:'HOLD'})};const app=express();app.use(express.json());app.use(createCapitalSafetyRoutes({auth,service}));app.use(capitalSafetyErrorMiddleware);await request(app).get('/governance/capital-safety/current/domain2:1:a').expect(200);});
});
