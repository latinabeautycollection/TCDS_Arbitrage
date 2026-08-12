import { pool } from "./db";
import type { EmailRecipient } from "../models/emailTypes";

export async function recipientAuthorized(
  email: string,
  eventType: string,
  classification: string
): Promise<boolean> {
  const r = await pool.query<{allowed:boolean}>(`
    SELECT EXISTS (
      SELECT 1
      FROM operations.email_recipient_authorizations
      WHERE lower(email_address)=lower($1)
        AND enabled=true
        AND valid_from <= now()
        AND (valid_until IS NULL OR valid_until > now())
        AND $2 LIKE replace(event_type_pattern,'*','%')
        AND operations.classification_rank(max_classification) >= operations.classification_rank($3)
    ) AS allowed`, [email,eventType,classification]);
  return r.rows[0]?.allowed ?? false;
}

export async function resolveAudience(audienceKey: string): Promise<EmailRecipient[]> {
  const r = await pool.query<{email_address:string;display_name:string|null}>(`
    SELECT d.email_address, d.display_name
    FROM operations.email_recipient_directory d
    JOIN operations.email_audience_members m ON m.recipient_id=d.recipient_id
    JOIN operations.email_audiences a ON a.audience_id=m.audience_id
    WHERE a.audience_key=$1
      AND a.enabled=true
      AND d.enabled=true
    ORDER BY lower(d.email_address)`, [audienceKey]);
  return r.rows.map(x => ({
    address:x.email_address,
    ...(x.display_name ? {name:x.display_name} : {})
  }));
}
