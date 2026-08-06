import type { Pool } from 'pg';
import type { ForensicPrincipal, AlertAction, ReportRequest } from '../models/operationsTypes';

export class OperationsRepository {
  constructor(private readonly pool: Pool) {}

  createAlert(p: ForensicPrincipal, i: {
    code:string;severity:string;sourceType:string;sourceReference:string;
    summary:string;details:unknown;dedupeKey:string;
  }) {
    return this.pool.query(
      `SELECT * FROM forensic.d7j2_create_alert_r5(
       $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::uuid,$10::uuid)`,
      [p.tenantKey,i.code,i.severity,i.sourceType,i.sourceReference,i.summary,
       JSON.stringify(i.details),i.dedupeKey,p.userId,p.authSessionId],
    ).then(x=>x.rows[0]);
  }

  listAlerts(p: ForensicPrincipal, status?: string) {
    return this.pool.query(
      `SELECT * FROM forensic.d7j2_list_alerts_r5($1,$2,$3::uuid,$4::uuid)`,
      [p.tenantKey,status??null,p.userId,p.authSessionId],
    ).then(x=>x.rows);
  }

  getAlert(p: ForensicPrincipal, id: string) {
    return this.pool.query(
      `SELECT * FROM forensic.d7j2_get_alert_r5($1::uuid,$2,$3::uuid,$4::uuid)`,
      [id,p.tenantKey,p.userId,p.authSessionId],
    ).then(x=>x.rows[0]);
  }

  alertEvents(p: ForensicPrincipal, id: string) {
    return this.pool.query(
      `SELECT * FROM forensic.d7j2_list_alert_events_r5($1::uuid,$2,$3::uuid,$4::uuid)`,
      [id,p.tenantKey,p.userId,p.authSessionId],
    ).then(x=>x.rows);
  }

  transition(p: ForensicPrincipal, id: string, action: AlertAction, reason: string, assignee?: string) {
    return this.pool.query(
      `SELECT * FROM forensic.d7j2_transition_alert_r5($1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid)`,
      [id,action,reason,p.userId,p.authSessionId,assignee??null],
    ).then(x=>x.rows[0]);
  }

  verifyAlert(p: ForensicPrincipal, id: string) {
    return this.pool.query(
      `SELECT forensic.d7j2_verify_alert_chain_authorized_r5($1::uuid,$2,$3::uuid,$4::uuid) AS valid`,
      [id,p.tenantKey,p.userId,p.authSessionId],
    ).then(x=>x.rows[0]);
  }

  snapshot(p: ForensicPrincipal) {
    return this.pool.query(
      `SELECT * FROM forensic.d7j2_generate_snapshot_r5($1,$2::uuid,$3::uuid)`,
      [p.tenantKey,p.userId,p.authSessionId],
    ).then(x=>x.rows[0]);
  }

  evaluateSla(p: ForensicPrincipal) {
    return this.pool.query(
      `SELECT * FROM forensic.d7j2_evaluate_sla_r5($1,$2::uuid,$3::uuid)`,
      [p.tenantKey,p.userId,p.authSessionId],
    ).then(x=>x.rows);
  }

  report(p: ForensicPrincipal, i: ReportRequest, hash: string) {
    return this.pool.query(
      `SELECT * FROM forensic.d7j2_generate_report_r5(
       $1,$2::date,$3::timestamptz,$4,$5,$6,$7::uuid,$8::uuid)`,
      [p.tenantKey,i.reportDate,i.asOfAt,i.schemaVersion,i.idempotencyKey,
       hash,p.userId,p.authSessionId],
    ).then(x=>x.rows[0]);
  }

  listReports(p: ForensicPrincipal) {
    return this.pool.query(
      `SELECT * FROM forensic.d7j2_list_reports_r5($1,$2::uuid,$3::uuid)`,
      [p.tenantKey,p.userId,p.authSessionId],
    ).then(x=>x.rows);
  }

  createHandoff(p: ForensicPrincipal, i: {
    releaseDecisionId:string;handoffCode:string;ownerUserId:string;backupOwnerUserId:string;
    runbookUri:string;ownership:unknown;
  }) {
    return this.pool.query(
      `SELECT * FROM forensic.d7j2_create_handoff_r5(
       $1,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7::jsonb,$8::uuid,$9::uuid)`,
      [p.tenantKey,i.releaseDecisionId,i.handoffCode,i.ownerUserId,i.backupOwnerUserId,
       i.runbookUri,JSON.stringify(i.ownership),p.userId,p.authSessionId],
    ).then(x=>x.rows[0]);
  }

  listHandoffs(p: ForensicPrincipal) {
    return this.pool.query(
      `SELECT * FROM forensic.d7j2_list_handoffs_r5($1,$2::uuid,$3::uuid)`,
      [p.tenantKey,p.userId,p.authSessionId],
    ).then(x=>x.rows);
  }

  attest(p: ForensicPrincipal, id: string, decision: 'ACCEPT'|'REJECT', notes: string) {
    return this.pool.query(
      `SELECT * FROM forensic.d7j2_attest_handoff_r5($1::uuid,$2,$3,$4::uuid,$5::uuid)`,
      [id,decision,notes,p.userId,p.authSessionId],
    ).then(x=>x.rows[0]);
  }
}
