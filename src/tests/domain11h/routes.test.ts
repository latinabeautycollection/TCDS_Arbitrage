import express from 'express';import request from 'supertest';
import {createKpiRoutes,type KpiRouteAuth} from '../../domains/governance/routes/kpiRoutes';
import {kpiErrorMiddleware} from '../../domains/governance/errors/kpiErrorMiddleware';
const allow:any=(_q:any,res:any,n:any)=>{res.locals.kpiPrincipal={reference:'user-1',authSessionId:'123e4567-e89b-42d3-a456-426614174000',permissions:['governance.kpi.read','governance.kpi.calculate','governance.kpi.admin']};n();};
const auth:KpiRouteAuth={read:allow,calculate:allow,admin:allow};
describe('11H V3 routes',()=>{
 test('invalid calculate is 400',async()=>{const app=express();app.use(express.json());app.use(createKpiRoutes({auth,service:{} as any}));app.use(kpiErrorMiddleware);await request(app).post('/governance/kpis/calculate').send({}).expect(400);});
 test('verify route is namespaced',async()=>{const service:any={verify:async()=>({status:'PASS'})};const app=express();app.use(createKpiRoutes({auth,service}));app.use(kpiErrorMiddleware);await request(app).get('/governance/kpis/snapshots/123e4567-e89b-42d3-a456-426614174000/verify').expect(200);});
});
