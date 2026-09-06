import type { Pool } from 'pg';
import { createDomain11lPool } from '../../../domains/governance/executive/db/domain11lDbPool';
const certificationMode=process.env.DOMAIN11L_CERTIFICATION_MODE==='1';
const suite=certificationMode?describe:describe.skip;
suite('Domain 11L PostgreSQL integration',()=>{
 let pool:Pool;
 beforeAll(()=>{if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required in DOMAIN11L_CERTIFICATION_MODE');pool=createDomain11lPool('domain11l-jest-integration')});
 afterAll(async()=>{await pool?.end()});
 test('all eleven exact upstream bindings and both sinks are installed',async()=>{
  const a=await pool.query('select count(*)::int n from arb.domain11l_authority_bindings');expect(a.rows[0].n).toBe(11);
  const b=await pool.query('select count(*)::int n from arb.domain11l_sink_bindings');expect(b.rows[0].n).toBe(2);
 });
 test('all upstreams report certified through the authoritative adapter',async()=>{
  const q=await pool.query(`select s, arb.domain11l_read_authority(s)->>'certificationState' state from unnest(array['11A','11B','11C','11D','11E','11F','11G','11H','11I','11J','11K']) s`);
  expect(q.rows).toHaveLength(11); for(const r of q.rows)expect(r.state).toBe('CERTIFIED');
 });
 test('PUBLIC cannot invoke final certification',async()=>{
  const q=await pool.query(`select has_function_privilege('public','arb.domain11l_certify_phase3(text,text,text,text,uuid,timestamptz,text,text,text,text,text,text,text,text,text,text,text,text)','EXECUTE') ok`);
  expect(q.rows[0].ok).toBe(false);
 });
});
