import{Pool}from'pg';
const url=process.env.DOMAIN11J_DATABASE_URL;if(process.env.DOMAIN11J_CERTIFICATION_MODE==='true'&&!url)throw new Error('DOMAIN11J_DATABASE_URL required in certification mode');const d=url?describe:describe.skip;
d('11J PostgreSQL base authority',()=>{const p=new Pool({connectionString:url});afterAll(async()=>p.end());
 test('precedence is deterministic',async()=>{const q=await p.query(`select arb.domain11j_control_rank('BLOCKED') b,arb.domain11j_control_rank('PAUSED') p,arb.domain11j_control_rank('DEGRADED') d,arb.domain11j_control_rank('GUARDED') g`);expect(q.rows[0].b).toBeGreaterThan(q.rows[0].p);expect(q.rows[0].p).toBeGreaterThan(q.rows[0].d);expect(q.rows[0].d).toBeGreaterThan(q.rows[0].g)});
 test('PUBLIC cannot execute 11J functions',async()=>{const q=await p.query(`select count(*)::int n from pg_proc x join pg_namespace n on n.oid=x.pronamespace cross join lateral aclexplode(coalesce(x.proacl,acldefault('f',x.proowner)))a where n.nspname='arb' and x.proname like 'domain11j_%' and a.grantee=0 and a.privilege_type='EXECUTE'`);expect(q.rows[0].n).toBe(0)});
});
