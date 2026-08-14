
import type { PoolClient } from "pg";

export class ExecutivePacketBuilder {
  public async build(
    client: PoolClient,
    releaseId: string,
    certificationRunId: string,
  ): Promise<Record<string, unknown>> {
    const findings = await client.query(
      `select severity,finding_status,count(*)::int count
       from return_defense.domain_release_findings f
       where certification_run_id=$1::uuid
       group by severity,finding_status`,
      [certificationRunId],
    );
    return {
      releaseId,
      certificationRunId,
      findingSummary: findings.rows,
      generatedAt: new Date().toISOString(),
      recommendation: findings.rows.some(
        (row) =>
          row.severity === "CRITICAL" &&
          !["RESOLVED", "WAIVED"].includes(row.finding_status),
      )
        ? "REJECT"
        : "APPROVE",
    };
  }
}
