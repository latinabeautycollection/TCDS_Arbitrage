import {Pool} from 'pg';
const describeDb=process.env.DOMAIN11F_RUNTIME_DATABASE_URL?describe:describe.skip;
describeDb('Domain11F dedicated runtime identity',()=>{
  const pool=new Pool({connectionString:process.env.DOMAIN11F_RUNTIME_DATABASE_URL});
  afterAll(async()=>pool.end());
  test('runtime login is least privilege and not an owner/admin',async()=>{
    const q=await pool.query(`select session_user,
      (select rolsuper from pg_roles where rolname=session_user) super,
      (select rolbypassrls from pg_roles where rolname=session_user) bypass,
      pg_has_role(session_user,'tcds_governance_capital_runtime','MEMBER') runtime,
      pg_has_role(session_user,'tcds_governance_capital_admin','MEMBER') admin,
      pg_has_role(session_user,'tcds_governance_owner','MEMBER') owner,
      has_table_privilege(session_user,'arb.capital_allocation_items','INSERT,UPDATE,DELETE') domain2_write`);
    const x=q.rows[0];expect(x.super).toBe(false);expect(x.bypass).toBe(false);expect(x.runtime).toBe(true);expect(x.admin).toBe(false);expect(x.owner).toBe(false);expect(x.domain2_write).toBe(false);
  });
});
