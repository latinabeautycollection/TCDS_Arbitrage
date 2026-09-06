import { Pool } from 'pg';

const describeDb = process.env.DOMAIN11E_DATABASE_URL ? describe : describe.skip;

describeDb('Domain 11E PostgreSQL adversarial integration', () => {
  const pool = new Pool({ connectionString: process.env.DOMAIN11E_DATABASE_URL });

  afterAll(async () => { await pool.end(); });

  test('PUBLIC cannot execute privileged Domain11E functions', async () => {
    const r = await pool.query(`
      select count(*)::int n
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where n.nspname='arb'
        and p.proname like 'domain11e_%'
        and a.grantee=0 and a.privilege_type='EXECUTE'
    `);
    expect(r.rows[0].n).toBe(0);
  });

  test('relationship semantics are immutable', async () => {
    await expect(pool.query(`
      update arb.lineage_relationship_types
      set description='tamper'
      where relationship_type_code='CAUSED'
    `)).rejects.toBeDefined();
  });

  test('chain verifier returns a structured result', async () => {
    const r = await pool.query(`select * from arb.domain11e_verify_chain('DOMAIN_11')`);
    expect(typeof r.rows[0]?.valid).toBe('boolean');
  });

  test('runtime role has no downstream write authority', async () => {
    const r = await pool.query(`
      select
        has_table_privilege('tcds_governance_lineage_runtime','arb.health_state_current','INSERT,UPDATE,DELETE') h,
        has_table_privilege('tcds_governance_lineage_runtime','arb.readiness_assessments','INSERT,UPDATE,DELETE') r,
        has_table_privilege('tcds_governance_lineage_runtime','arb.capital_safety_assessments','INSERT,UPDATE,DELETE') c
    `);
    expect(r.rows[0]).toEqual({h:false,r:false,c:false});
  });
});
