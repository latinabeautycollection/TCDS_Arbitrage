import crypto from 'node:crypto';
import { Pool } from 'pg';
import { CapitalSafetyRepository } from '../../domains/governance/repositories/capitalSafetyRepository';
import { Domain2CapitalStateProvider } from '../../domains/governance/providers/domain2CapitalStateProvider';
import { CapitalSafetyService } from '../../domains/governance/services/capitalSafetyService';
import { noopCapitalSafetyMetrics } from '../../domains/governance/observability/capitalSafetyObservability';

const required=['DOMAIN11F_RUNTIME_DATABASE_URL','DOMAIN11F_CONCURRENCY_RUN_ID_A','DOMAIN11F_CONCURRENCY_SOURCE_RECORD_A','DOMAIN11F_CONCURRENCY_RUN_ID_B','DOMAIN11F_CONCURRENCY_SOURCE_RECORD_B'] as const;
const enabled=required.every(k=>Boolean(process.env[k]));
const describeDb=enabled?describe:describe.skip;
const logger={info:()=>undefined,warn:()=>undefined,error:()=>undefined};
const principal={reference:'DOMAIN11F_CERTIFICATION',authSessionId:'123e4567-e89b-42d3-a456-426614174000',permissions:['governance.capital-safety.admin']};

describeDb('Domain11F real concurrent assessment safety',()=>{
  const url=process.env.DOMAIN11F_RUNTIME_DATABASE_URL!;
  const poolA=new Pool({connectionString:url,max:2});
  const poolB=new Pool({connectionString:url,max:2});
  afterAll(async()=>{await Promise.all([poolA.end(),poolB.end()]);});

  test('two individually valid proposals cannot jointly exceed the certified capital envelope',async()=>{
    const runA=Number(process.env.DOMAIN11F_CONCURRENCY_RUN_ID_A),runB=Number(process.env.DOMAIN11F_CONCURRENCY_RUN_ID_B);
    const srcA=process.env.DOMAIN11F_CONCURRENCY_SOURCE_RECORD_A!,srcB=process.env.DOMAIN11F_CONCURRENCY_SOURCE_RECORD_B!;
    const repoA=new CapitalSafetyRepository(poolA),repoB=new CapitalSafetyRepository(poolB);
    const svcA=new CapitalSafetyService(repoA,new Domain2CapitalStateProvider(),logger,noopCapitalSafetyMetrics);
    const svcB=new CapitalSafetyService(repoB,new Domain2CapitalStateProvider(),logger,noopCapitalSafetyMetrics);

    const pre=await poolA.connect();
    let amountA=0,amountB=0,total=0,daily=0;
    try{
      const [a,b,p]=await Promise.all([
        repoA.loadProposal(pre,runA,srcA),repoA.loadProposal(pre,runB,srcB),repoA.loadPolicy(pre)
      ]);
      amountA=a.requestedAmount;amountB=b.requestedAmount;
      if(!p)throw new Error('CERT_FIXTURE_REQUIRES_ACTIVE_CAPITAL_SAFETY_POLICY');
      total=Number(p.configuration.totalCapitalCeiling);daily=Number(p.configuration.dailyCapitalCeiling);
      if(!Number.isFinite(total)||!Number.isFinite(daily))throw new Error('CERT_FIXTURE_POLICY_CEILINGS_MISSING');
      if(amountA>total||amountB>total||amountA>daily||amountB>daily)throw new Error('CERT_FIXTURE_EACH_PROPOSAL_MUST_FIT_INDIVIDUALLY');
      if(amountA+amountB<=Math.min(total,daily))throw new Error('CERT_FIXTURE_COMBINED_PROPOSALS_MUST_EXCEED_A_CERTIFIED_CEILING');
    }finally{pre.release();}

    const stamp=Date.now();
    const [a,b]=await Promise.all([
      svcA.assess(principal,{capitalAllocationRunId:runA,sourceRecordId:srcA,correlationId:crypto.randomUUID(),idempotencyKey:`11f-concurrency-a-${stamp}`}),
      svcB.assess(principal,{capitalAllocationRunId:runB,sourceRecordId:srcB,correlationId:crypto.randomUUID(),idempotencyKey:`11f-concurrency-b-${stamp}`})
    ]);
    const safe=[a,b].filter(x=>x.assessmentAllowsExecutionSubjectToRevalidation);
    expect(safe.length).toBeLessThanOrEqual(1);
    expect([a,b].some(x=>x.persisted)).toBe(true);
  },30000);
});
