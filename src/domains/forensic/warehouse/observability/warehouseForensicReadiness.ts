import type { Pool } from 'pg';

export async function checkWarehouseForensicReadiness(pool:Pool){
  const {rows}=await pool.query(`
    SELECT
      to_regprocedure('forensic.d7b_evaluate_gate(uuid,text,forensic.event_actor_type,text,uuid,uuid)') IS NOT NULL AS functions_ready,
      to_regclass('warehouse_identity.auth_sessions') IS NOT NULL AS identity_ready,
      to_regclass('warehouse_control.asset_health_current') IS NOT NULL AS control_ready,
      to_regclass('warehouse_telemetry.scale_measurements') IS NOT NULL AS telemetry_ready,
      EXISTS(SELECT 1 FROM arb.process_registry WHERE process_name='D7B_GATE_EVALUATE' AND active_flag) AS process_ready
  `);
  const state=rows[0] as Record<string,boolean>;
  return {ready:Object.values(state).every(Boolean),checks:state};
}
