import { logger } from '../lib/logger';
import { CertificationService } from '../services/certificationService';
import { pool } from '../db/pool';
import { redisConnection } from '../queues/bullmq';

function requireArg(name: string): string {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!arg) {
    throw new Error(`Missing required argument --${name}=...`);
  }
  return arg.split('=').slice(1).join('=');
}

async function main() {
  const processRunId = requireArg('runId');
  const entityType = requireArg('entityType');
  const entityPk = requireArg('entityPk');
  const processName = requireArg('processName');
  const idempotencyKey = requireArg('idempotencyKey');

  const service = new CertificationService();

  const report = await service.runFullCertification({
    processRunId,
    entityType,
    entityPk,
    processName,
    idempotencyKey
  });

  for (const check of report.checks) {
    const method = check.ok ? 'info' : 'error';
    logger[method](
      {
        check: check.name,
        ok: check.ok,
        ...(check.meta ? { meta: check.meta } : {})
      },
      check.detail
    );
  }

  await service.stampCertification(processRunId, report);

  logger.info(
    {
      processRunId,
      overallOk: report.overallOk,
      generatedAt: report.generatedAt
    },
    'Phase 2 certification summary'
  );

  await redisConnection.quit();
  await pool.end();

  process.exit(report.overallOk ? 0 : 1);
}

main().catch(async (error) => {
  logger.error({ err: error }, 'certification script failed');

  try {
    await redisConnection.quit();
  } catch {}

  try {
    await pool.end();
  } catch {}

  process.exit(1);
});
