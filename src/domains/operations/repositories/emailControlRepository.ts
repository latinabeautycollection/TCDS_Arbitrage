import { pool } from "./db";

export async function assertEmailEnabled(): Promise<void> {
  const r = await pool.query<{enabled:boolean}>(
    `SELECT enabled FROM operations.email_system_controls WHERE channel='EMAIL'`
  );
  if (r.rowCount !== 1 || !r.rows[0]?.enabled) throw new Error("Domain 10 email is disabled by database kill switch");
}
