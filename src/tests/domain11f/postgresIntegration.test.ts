import { Pool } from 'pg';
const describeDb=process.env.DOMAIN11F_RUNTIME_DATABASE_URL?describe:describe.skip;
describeDb('Domain11F PostgreSQL integration',()=>{
  const pool=new Pool({connectionString:process.env.DOMAIN11F_RUNTIME_DATABASE_URL});
  afterAll(async()=>pool.end());
  test('PUBLIC cannot execute Domain11F functions',async()=>{
    const r=await pool.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where n.nspname='arb' and p.proname like 'domain11f_%' and a.grantee=0 and a.privilege_type='EXECUTE'`);
    expect(r.rows[0].n).toBe(0);
  });
  test('runtime cannot mutate Domain2',async()=>{
    const r=await pool.query(`select
      has_table_privilege('tcds_governance_capital_runtime','arb.capital_allocation_runs','INSERT,UPDATE,DELETE') runs,
      has_table_privilege('tcds_governance_capital_runtime','arb.capital_allocation_items','INSERT,UPDATE,DELETE') items`);
    expect(r.rows[0]).toEqual({runs:false,items:false});
  });
  test('expired current safety fails closed',async()=>{
    const r=await pool.query(`select count(*)::int n from arb.v_effective_capital_safety_current
      where expired and assessment_was_allow_and_not_expired`);
    expect(r.rows[0].n).toBe(0);
  });
});
