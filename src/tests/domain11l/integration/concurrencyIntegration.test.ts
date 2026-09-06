import type { Pool } from 'pg';
import { createDomain11lPool } from '../../../domains/governance/executive/db/domain11lDbPool';
const suite=process.env.DOMAIN11L_CERTIFICATION_MODE==='1'?describe:describe.skip;
suite('Domain 11L certification serialization',()=>{let pool:Pool;beforeAll(()=>{if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');pool=createDomain11lPool('domain11l-jest-integration')});afterAll(async()=>pool.end());
 test('global certification advisory lock serializes contenders',async()=>{const a=await pool.connect();const b=await pool.connect();try{await a.query('begin');await a.query(`select pg_advisory_xact_lock(hashtextextended('TCDS_PHASE3_DOMAIN11L_CERTIFICATION',0))`);const start=Date.now();const waiter=(async()=>{await b.query('begin');await b.query(`select pg_advisory_xact_lock(hashtextextended('TCDS_PHASE3_DOMAIN11L_CERTIFICATION',0))`);await b.query('commit');return Date.now()-start})();await new Promise(r=>setTimeout(r,400));await a.query('commit');expect(await waiter).toBeGreaterThanOrEqual(350)}finally{try{await a.query('rollback')}catch{}try{await b.query('rollback')}catch{}a.release();b.release()}});
});
