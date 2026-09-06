import{Pool}from'pg';
const url=process.env.DOMAIN11I_DATABASE_URL;
if(process.env.DOMAIN11I_CERTIFICATION_MODE==='true'&&!url)throw new Error('DOMAIN11I_DATABASE_URL required in certification mode');
const d=url?describe:describe.skip;
d('11I V2 PostgreSQL authority',()=>{
 const p=new Pool({connectionString:url});afterAll(async()=>p.end());
 test('99.9 percent error budget arithmetic',async()=>{const q=await p.query(`select arb.domain11i_v2_error_budget_math(.999,999,1) j`);expect(Number(q.rows[0].j.burnRate)).toBeCloseTo(1,8)});
 test('10x burn arithmetic',async()=>{const q=await p.query(`select arb.domain11i_v2_error_budget_math(.999,990,10) j`);expect(Number(q.rows[0].j.burnRate)).toBeCloseTo(10,8)});
 test('directionality distinguishes favorable ROI improvement',async()=>{const q=await p.query(`select arb.domain11i_v2_adverse_drift(-10,'LOWER_IS_BAD') bad,arb.domain11i_v2_adverse_drift(10,'LOWER_IS_BAD') good`);expect(Number(q.rows[0].bad)).toBe(10);expect(Number(q.rows[0].good)).toBe(0)});
 test('runtime cannot execute V1 evaluator',async()=>{const q=await p.query(`select has_function_privilege('tcds_governance_reliability_runtime','arb.domain11i_evaluate_slo(uuid,timestamp with time zone,timestamp with time zone,text)','EXECUTE') x`);expect(q.rows[0].x).toBe(false)});
 test('admin cannot forge baseline rows directly',async()=>{const q=await p.query(`select has_table_privilege('tcds_governance_reliability_admin','arb.drift_baselines_11i','INSERT') x`);expect(q.rows[0].x).toBe(false)});
});