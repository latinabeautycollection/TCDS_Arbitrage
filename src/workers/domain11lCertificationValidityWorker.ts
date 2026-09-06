import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { createDomain11lPool } from '../domains/governance/executive/db/domain11lDbPool';

const intervalMs = Number(process.env.DOMAIN11L_VALIDITY_INTERVAL_MS ?? 60_000);
if(!Number.isFinite(intervalMs) || intervalMs < 1_000) throw new Error('DOMAIN11L_VALIDITY_INTERVAL_MS must be >= 1000');
const pool=createDomain11lPool('domain11l-certification-validity-worker');
const workerId='domain11l-certification-validity-worker';
const instanceId=process.env.DOMAIN11L_WORKER_INSTANCE_ID?.trim() || `${os.hostname()}:${process.pid}`;
let stopping = false;

async function heartbeat(status:'HEALTHY'|'DEGRADED'|'FAILED',correlationId:string,details:Record<string,unknown>={}):Promise<void>{
  await pool.query(`SELECT arb.domain11l_record_validity_worker_heartbeat($1,$2,$3,$4,$5::jsonb)`,
    [workerId,instanceId,status,correlationId,JSON.stringify(details)]);
}
async function reconcile(): Promise<void> {
  const correlationId = randomUUID();
  try {
    await heartbeat('HEALTHY',correlationId,{phase:'before_reconcile'});
    const result = await pool.query(
      `SELECT arb.domain11l_reconcile_phase3_validity('SYSTEM',$1,$2) AS revocation_id`,
      [workerId,correlationId],
    );
    const id = result.rows[0]?.revocation_id;
    await heartbeat('HEALTHY',correlationId,{phase:'after_reconcile',revocationId:id?String(id):null});
    if (id) process.stdout.write(JSON.stringify({level:'warn',operation:'domain11l.validity.reconcile',outcome:'REVOKED',revocationId:String(id),correlationId})+'\n');
  } catch (error) {
    try { await heartbeat('FAILED',correlationId,{error:error instanceof Error?error.message:String(error)}); } catch {/* original failure remains authoritative */}
    process.stderr.write(JSON.stringify({level:'error',operation:'domain11l.validity.reconcile',outcome:'FAILED',correlationId,error:error instanceof Error?error.message:String(error)})+'\n');
  }
}
async function shutdown(signal:string){stopping=true;process.stdout.write(JSON.stringify({level:'info',operation:'domain11l.validity.shutdown',signal})+'\n');await pool.end();process.exit(0)}
process.on('SIGTERM',()=>void shutdown('SIGTERM')); process.on('SIGINT',()=>void shutdown('SIGINT'));
(async()=>{while(!stopping){await reconcile();await new Promise(r=>setTimeout(r,intervalMs));}})().catch(async e=>{process.stderr.write(String(e)+'\n');await pool.end();process.exit(1)});
