import {Pool} from 'pg';
const required=['DOMAIN11F_RUNTIME_DATABASE_URL','DOMAIN11F_COMMITTED_EXTERNAL_DECISION_ID','DOMAIN11F_STALE_UPSTREAM_EXTERNAL_DECISION_ID'] as const;
const describeDb=required.every(k=>Boolean(process.env[k]))?describe:describe.skip;
describeDb('Domain11F execution-time revalidation',()=>{
  const pool=new Pool({connectionString:process.env.DOMAIN11F_RUNTIME_DATABASE_URL});
  afterAll(async()=>pool.end());
  test('committed/executing proposal is not execution eligible',async()=>{const r=await pool.query(`select * from arb.domain11f_revalidate_execution_eligibility($1)`,[process.env.DOMAIN11F_COMMITTED_EXTERNAL_DECISION_ID]);expect(r.rows[0]?.eligible).toBe(false);expect((r.rows[0]?.reason_codes??[]).some((x:string)=>x.includes('SIDE_EFFECT'))).toBe(true);});
  test('stale/revoked upstream fact invalidates prior assessment',async()=>{const r=await pool.query(`select * from arb.domain11f_revalidate_execution_eligibility($1)`,[process.env.DOMAIN11F_STALE_UPSTREAM_EXTERNAL_DECISION_ID]);expect(r.rows[0]?.eligible).toBe(false);expect((r.rows[0]?.reason_codes??[]).length).toBeGreaterThan(0);});
});
