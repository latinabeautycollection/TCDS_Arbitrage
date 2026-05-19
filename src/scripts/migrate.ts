import fs from 'fs/promises';
import path from 'path';
import { pool } from '../db/pool';
import { logger } from '../lib/logger';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'db', 'migrations');

async function ensureSchemaMigrationTable() {
  await pool.query(`
    create table if not exists arb.schema_migration (
      id bigint generated always as identity primary key,
      filename text not null unique,
      applied_at timestamptz not null default now()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const { rows } = await pool.query(
    `select filename from arb.schema_migration order by filename asc`
  );
  return new Set(rows.map((row) => row.filename as string));
}

async function main() {
  await ensureSchemaMigrationTable();

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const applied = await getAppliedMigrations();

  for (const filename of files) {
    if (applied.has(filename)) {
      logger.info({ filename }, 'migration already applied');
      continue;
    }

    const fullPath = path.join(MIGRATIONS_DIR, filename);
    const sql = await fs.readFile(fullPath, 'utf8');

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query(
        `insert into arb.schema_migration (filename) values ($1)`,
        [filename]
      );
      await client.query('commit');
      logger.info({ filename }, 'migration applied');
    } catch (err) {
      try {
        await client.query('rollback');
      } catch {}
      logger.error({ err, filename }, 'migration failed');
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch(async (err) => {
  logger.error({ err }, 'migration runner failed');
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
