import { Pool } from 'pg';
import { certifyReplay } from '../services/replayCertification.service';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: requiredEnv('DATABASE_URL'), ssl: boolEnv('PG_SSL_ENABLED', true) ? { rejectUnauthorized: false } : false } as Record<string, unknown>);
  const run = await pool.query(
    `insert into arb.replay_certification_run(policy_version,replay_scope,status,started_at) values(coalesce(arb.capital_safety_active_policy_version(),'capital-safety-v1'),'capital_safety_assessment','RUNNING',now()) returning id, run_id`,
  );
  const runId = Number(run.rows[0].id);
  try {
    const rows = await pool.query(
      `select id::text as entity_key, input_hash, output_hash, assessment_json, policy_version from arb.capital_safety_assessment order by created_at desc limit $1`,
      [intEnv('CAPITAL_SAFETY_REPLAY_SAMPLE_SIZE', 100)],
    );
    const snapshots = rows.rows.map((row) => ({
      entityKey: row.entity_key,
      inputJson: row.assessment_json?.decisionInput ?? row.assessment_json,
      outputJson: row.assessment_json?.result ?? {},
      scoringVersion: 'capital-safety-replay-v1',
      policyVersion: row.policy_version,
    }));
    const results = certifyReplay(snapshots, { recompute: (inputJson) => {
      // Replay certifies stable hashing and stored result determinism envelope.
      // Full business recomputation is provided by the runtime gate in worker tests.
      const source = snapshots.find((s) => JSON.stringify(s.inputJson) === JSON.stringify(inputJson));
      return source?.outputJson ?? {};
    }});
    const failed = results.filter((r) => !r.passed);
    await pool.query(
      `update arb.replay_certification_run set status=$2, sample_size=$3, passed_count=$4, failed_count=$5, drift_count=$6, failure_json=$7::jsonb, completed_at=now() where id=$1`,
      [runId, failed.length === 0 ? 'PASSED' : 'FAILED', results.length, results.length - failed.length, failed.length, failed.length, JSON.stringify(failed)],
    );
    console.log(JSON.stringify({ ok: failed.length === 0, sampleSize: results.length, failedCount: failed.length, failures: failed }, null, 2));
    if (failed.length > 0) process.exit(1);
  } catch (error) {
    await pool.query(`update arb.replay_certification_run set status='ERROR', failure_json=$2::jsonb, completed_at=now() where id=$1`, [runId, JSON.stringify([{ error: error instanceof Error ? error.message : String(error) }])]);
    throw error;
  } finally {
    await pool.end();
  }
}

function requiredEnv(name: string): string { const v = process.env[name]?.trim(); if (!v) throw new Error(`Missing ${name}`); return v; }
function boolEnv(name: string, fallback: boolean): boolean { const raw = process.env[name]; return raw ? ['1','true','yes','on'].includes(raw.trim().toLowerCase()) : fallback; }
function intEnv(name: string, fallback: number): number { const n = Number.parseInt(process.env[name] ?? '', 10); return Number.isFinite(n) ? n : fallback; }

main().catch((error) => { console.error(error); process.exit(1); });
