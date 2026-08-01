import type { Pool } from 'pg';
import type { ForensicPrincipal } from '../../auth/forensicPrincipal';

export class ArbProcessRunAdapter {
  constructor(private readonly pool: Pool) {}

  async start(input: {
    processName: string;
    stage: string;
    principal: ForensicPrincipal;
    correlationId: string;
    idempotencyKey: string;
    entityType: string;
  }): Promise<string> {
    const { rows } = await this.pool.query(
      `INSERT INTO arb.process_runs(
        process_name,process_stage,status,correlation_id,actor_type,actor_id,actor_name,
        entity_type,idempotency_key,details_json)
       VALUES($1,$2,'STARTED',$3,$4,$5,$6,$7,$8,'{}'::jsonb)
       RETURNING run_id`,
      [
        input.processName,input.stage,input.correlationId,input.principal.actorType,
        input.principal.actorId,input.principal.actorName ?? null,input.entityType,
        input.idempotencyKey,
      ],
    );
    return String(rows[0].run_id);
  }

  async finish(
    runId: string,
    status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED',
    details: Record<string, unknown>,
    error?: unknown,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE arb.process_runs
       SET status=$2,completed_at=CASE WHEN $2<>'FAILED' THEN clock_timestamp() ELSE completed_at END,
           failed_at=CASE WHEN $2='FAILED' THEN clock_timestamp() ELSE failed_at END,
           error_class=CASE WHEN $2='FAILED' THEN $3 ELSE NULL END,
           error_summary=CASE WHEN $2='FAILED' THEN $4 ELSE NULL END,
           details_json=$5::jsonb,updated_at=clock_timestamp()
       WHERE run_id=$1::uuid AND status='STARTED'`,
      [
        runId,status,error instanceof Error ? error.name : null,
        error instanceof Error ? error.message : null,JSON.stringify(details),
      ],
    );
  }
}
