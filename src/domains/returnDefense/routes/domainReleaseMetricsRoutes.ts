import { Router } from "express";
import type { Pool } from "pg";

export function buildDomainReleaseMetricsRoutes(pool: Pool): Router {
  const router = Router();

  router.get("/domain8/release/metrics", async (_req, res, next) => {
    try {
      const result = await pool.query<{
        release_queue_depth: string | number;
        release_dead_letters: string | number;
        open_findings: string | number;
        critical_findings: string | number;
        unverified_runtime_integrations: string | number;
      }>("select * from return_defense.v_domain8_release_metrics");

      const row = result.rows[0] ?? {
        release_queue_depth: 0,
        release_dead_letters: 0,
        open_findings: 0,
        critical_findings: 0,
        unverified_runtime_integrations: 0,
      };

      const lines = [
        "# HELP tcds_domain8_release_queue_depth Queued or retryable Domain 8 release jobs",
        "# TYPE tcds_domain8_release_queue_depth gauge",
        `tcds_domain8_release_queue_depth ${Number(row.release_queue_depth)}`,
        "# HELP tcds_domain8_release_dead_letters Domain 8 release dead-letter jobs",
        "# TYPE tcds_domain8_release_dead_letters gauge",
        `tcds_domain8_release_dead_letters ${Number(row.release_dead_letters)}`,
        "# HELP tcds_domain8_release_open_findings Open Domain 8 release findings",
        "# TYPE tcds_domain8_release_open_findings gauge",
        `tcds_domain8_release_open_findings ${Number(row.open_findings)}`,
        "# HELP tcds_domain8_release_critical_findings Critical Domain 8 release findings",
        "# TYPE tcds_domain8_release_critical_findings gauge",
        `tcds_domain8_release_critical_findings ${Number(row.critical_findings)}`,
        "# HELP tcds_domain8_release_unverified_runtime_integrations Unverified Domain 8 runtime integrations",
        "# TYPE tcds_domain8_release_unverified_runtime_integrations gauge",
        `tcds_domain8_release_unverified_runtime_integrations ${Number(row.unverified_runtime_integrations)}`,
      ];

      res.type("text/plain").send(`${lines.join("\n")}\n`);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
