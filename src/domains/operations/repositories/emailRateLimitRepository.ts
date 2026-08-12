import { pool } from "./db";

export async function acquireSubmissionPermit(limitPerMinute:number):Promise<boolean>{
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    const bucket=new Date();
    bucket.setUTCSeconds(0,0);
    const r=await c.query<{submission_count:number}>(`
      INSERT INTO operations.email_submission_rate(bucket_minute,submission_count)
      VALUES($1,1)
      ON CONFLICT(bucket_minute) DO UPDATE
      SET submission_count=operations.email_submission_rate.submission_count+1
      WHERE operations.email_submission_rate.submission_count < $2
      RETURNING submission_count`,[bucket,limitPerMinute]);
    await c.query("COMMIT");
    return r.rowCount===1;
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
