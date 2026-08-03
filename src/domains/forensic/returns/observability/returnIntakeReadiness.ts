import type{Pool}from'pg';export async function returnIntakeReadiness(pool:Pool){const{rows}=await pool.query(`
SELECT to_regclass('forensic.return_intake_links') IS NOT NULL schema_ready,
to_regprocedure('forensic.d7d1_evaluate_gate(uuid,text,text,forensic.event_actor_type,uuid,uuid)') IS NOT NULL functions_ready,
to_regclass('warehouse.return_sessions') IS NOT NULL warehouse_ready`);const c=rows[0];return{ready:Object.values(c).every(Boolean),checks:c}}
