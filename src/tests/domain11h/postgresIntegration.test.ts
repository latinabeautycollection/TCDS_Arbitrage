import {Pool} from 'pg';
const d=process.env.DOMAIN11H_DATABASE_URL?describe:describe.skip;
d('11H V3 PostgreSQL integration',()=>{
 const pool=new Pool({connectionString:process.env.DOMAIN11H_DATABASE_URL});afterAll(async()=>pool.end());
 test('all active 11H definitions have immutable calculator bindings',async()=>{const q=await pool.query(`select count(*)::int n from arb.metric_definitions d left join arb.metric_definition_calculator_bindings b using(metric_definition_id) where d.version_label='11h-v1' and b.binding_id is null`);expect(q.rows[0].n).toBe(0);});
 test('calculator implementation hashes match deployed functions',async()=>{const q=await pool.query(`select count(*)::int n from arb.metric_definition_calculator_bindings b join arb.metric_calculator_registry_v3 c using(calculator_code,calculator_version) where b.calculator_implementation_sha256<>arb.domain11h_function_sha_v3(c.calculator_function)`);expect(q.rows[0].n).toBe(0);});
 test('true half-even ties to even',async()=>{const q=await pool.query(`select arb.domain11h_round_v3(1.005,2,'HALF_EVEN')::text a,arb.domain11h_round_v3(1.015,2,'HALF_EVEN')::text b`);expect(Number(q.rows[0].a)).toBe(1);expect(Number(q.rows[0].b)).toBe(1.02);});
 test('runtime source views are not directly exposed to capability roles',async()=>{const q=await pool.query(`select has_table_privilege('tcds_governance_kpi_user_runtime','arb.v_domain11h_realized_economic_events','SELECT') u,has_table_privilege('tcds_governance_kpi_service_runtime','arb.v_domain11h_realized_economic_events','SELECT') s`);expect(q.rows[0]).toEqual({u:false,s:false});});
});
