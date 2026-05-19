import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function refreshEbayToken() {
  const clientId = process.env.EBAY_PROD_CLIENT_ID!;
  const clientSecret = process.env.EBAY_PROD_CLIENT_SECRET!;
  const scope = encodeURIComponent(process.env.EBAY_PROD_SCOPES ?? 'https://api.ebay.com/oauth/api_scope');

  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: `grant_type=client_credentials&scope=${scope}`,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`eBay token refresh failed: ${res.status} ${body}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number; token_type: string };
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await pool.query(`
    UPDATE arb.ebay_oauth_tokens
    SET access_token = $1,
        access_expires_at = $2,
        last_refresh_at = now(),
        last_error = null,
        updated_at = now()
    WHERE environment = 'production' AND is_active = true
  `, [data.access_token, expiresAt]);

  console.log(JSON.stringify({ ts: new Date().toISOString(), msg: 'eBay token refreshed', expiresAt }));
  await pool.end();
}

refreshEbayToken().catch(err => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), msg: 'eBay token refresh failed', error: err.message }));
  process.exit(1);
});
