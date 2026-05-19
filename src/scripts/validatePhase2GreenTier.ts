import { Pool } from 'pg';

const requiredTables = [
  'arb.worker_heartbeats',
  'arb.opportunity_queue',
  'arb.candidates',
  'arb.listings',
  'arb.decisions',
  'arb.ebay_market',
  'arb.capital_safety_policy',
  'arb.capital_safety_assessment',
  'arb.forensic_mutation_ledger',
  'arb.prong2_comp_grounding_assessment',
  'arb.capital_safety_dead_letter',
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: requiredEnv('DATABASE_URL'), ssl: boolEnv('PG_SSL_ENABLED', true) ? { rejectUnauthorized: false } : false } as Record<string, unknown>);
  const failures: string[] = [];
  try {
    await pool.query('select 1');
    for (const table of requiredTables) {
      const [schema, name] = table.split('.');
      const r = await pool.query(
        `select exists(select 1 from information_schema.tables where table_schema=$1 and table_name=$2) as ok`,
        [schema, name],
      );
      if (!r.rows[0]?.ok) failures.push(`Missing table ${table}`);
    }
    const activePolicy = await pool.query(`select count(*)::int as c from arb.capital_safety_policy where is_active=true`);
    if (Number(activePolicy.rows[0]?.c ?? 0) < 1) failures.push('No active capital safety policy');

    const hb = await pool.query(`select count(*)::int as c from arb.worker_heartbeats where worker_name in ('phase2-hardening-worker','prong2-comp-set-grounding-worker') and last_seen_at > now() - interval '10 minutes'`);
    const heartbeatCount = Number(hb.rows[0]?.c ?? 0);

    const report = {
      ok: failures.length === 0,
      checkedAt: new Date().toISOString(),
      failures,
      warnings: heartbeatCount === 0 ? ['Capital safety workers have not reported heartbeat in last 10 minutes'] : [],
      heartbeatCount,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(1);
  } finally {
    await pool.end();
  }
}

function requiredEnv(name: string): string { const v = process.env[name]?.trim(); if (!v) throw new Error(`Missing ${name}`); return v; }
function boolEnv(name: string, fallback: boolean): boolean { const raw = process.env[name]; return raw ? ['1','true','yes','on'].includes(raw.trim().toLowerCase()) : fallback; }

main().catch((error) => { console.error(error); process.exit(1); });
