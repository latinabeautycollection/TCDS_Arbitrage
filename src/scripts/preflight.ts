import { logger } from '../lib/logger';
import {
  runFullPreflightChecks,
  closePreflightResources
} from '../lib/preflight';

async function main() {
  const report = await runFullPreflightChecks();

  for (const result of report.results) {
    const method =
      result.ok ? 'info' : result.severity === 'CRITICAL' ? 'error' : 'warn';

    logger[method](
      {
        check: result.name,
        severity: result.severity,
        ok: result.ok,
        ...(result.meta ? { meta: result.meta } : {})
      },
      result.detail
    );
  }

  logger.info(
    {
      totalChecks: report.summary.totalChecks,
      passed: report.summary.passed,
      failed: report.summary.failed,
      warnings: report.summary.warnings,
      criticalFailures: report.summary.criticalFailures
    },
    'forensic preflight summary'
  );

  await closePreflightResources();
  process.exit(report.summary.criticalFailures > 0 ? 1 : 0);
}

main().catch(async (error) => {
  logger.error({ err: error }, 'forensic preflight crashed');
  await closePreflightResources();
  process.exit(1);
});
