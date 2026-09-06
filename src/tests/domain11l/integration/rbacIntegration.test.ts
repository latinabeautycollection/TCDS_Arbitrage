import type { Pool } from 'pg';
import { createDomain11lPool } from '../../../domains/governance/executive/db/domain11lDbPool';
const suite=process.env.DOMAIN11L_CERTIFICATION_MODE==='1'?describe:describe.skip;
suite('Domain 11L RBAC integration',()=>{let pool:Pool;beforeAll(()=>{if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');pool=createDomain11lPool('domain11l-jest-integration')});afterAll(async()=>pool.end());
 test('11L group roles have no dangerous attributes',async()=>{const q=await pool.query(`select rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=any($1)`,[[
 'tcds_governance_executive_reader','tcds_governance_executive_snapshot_runtime','tcds_governance_phase3_certification_runtime','tcds_governance_phase3_certification_revoker']]);expect(q.rows).toHaveLength(4);for(const r of q.rows){expect(r.rolcanlogin).toBe(false);expect(r.rolsuper).toBe(false);expect(r.rolcreatedb).toBe(false);expect(r.rolcreaterole).toBe(false);expect(r.rolreplication).toBe(false);expect(r.rolbypassrls).toBe(false)}});
 test('11L roles have no upstream DML grants',async()=>{const q=await pool.query(`select count(*)::int n from information_schema.role_table_grants where grantee=any($1) and table_schema='arb' and privilege_type=any(array['INSERT','UPDATE','DELETE','TRUNCATE']) and table_name not like 'executive_%' and table_name not like 'phase3_%' and table_name not like 'domain11l_%'`,[[
 'tcds_governance_executive_reader','tcds_governance_executive_snapshot_runtime','tcds_governance_phase3_certification_runtime','tcds_governance_phase3_certification_revoker']]);expect(q.rows[0].n).toBe(0)});
});
