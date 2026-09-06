import express from'express';import request from'supertest';
import{createReliabilityRoutes}from'../../domains/governance/routes/reliabilityRoutes';
import{reliabilityErrorMiddleware}from'../../domains/governance/errors/reliabilityErrorMiddleware';
const allow:any=(_q:any,s:any,n:any)=>{s.locals.reliabilityPrincipal={reference:'u',authSessionId:'123e4567-e89b-42d3-a456-426614174000',permissions:['governance.reliability.read','governance.reliability.evaluate','governance.reliability.admin']};n()};
test('invalid SLO id returns 400',async()=>{const app=express();app.use(express.json());app.use(createReliabilityRoutes({service:{} as any,read:allow,evaluate:allow,admin:allow}));app.use(reliabilityErrorMiddleware);await request(app).post('/governance/reliability/slos/no/evaluate').send({idempotencyKey:'x',requestId:'123e4567-e89b-42d3-a456-426614174000',correlationId:'123e4567-e89b-42d3-a456-426614174000'}).expect(400)});
