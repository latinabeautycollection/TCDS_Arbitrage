import { createHash } from 'node:crypto';
import type { ForensicPrincipal, AlertAction, ReportRequest } from '../models/operationsTypes';
import { OperationsRepository } from '../repositories/operationsRepository';

export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  private require(p: ForensicPrincipal, permission: string): void {
    if (p.assuranceLevel !== 'AAL2' || !p.permissions.includes(permission)) {
      throw new Error('Forbidden');
    }
  }

  createAlert(p: ForensicPrincipal, i: Parameters<OperationsRepository['createAlert']>[1]) {
    this.require(p,'forensic.operations.alert.manage'); return this.repo.createAlert(p,i);
  }
  listAlerts(p: ForensicPrincipal,status?:string) {
    this.require(p,'forensic.operations.view'); return this.repo.listAlerts(p,status);
  }
  getAlert(p: ForensicPrincipal,id:string) {
    this.require(p,'forensic.operations.view'); return this.repo.getAlert(p,id);
  }
  alertEvents(p: ForensicPrincipal,id:string) {
    this.require(p,'forensic.operations.view'); return this.repo.alertEvents(p,id);
  }
  transition(p: ForensicPrincipal,id:string,a:AlertAction,r:string,u?:string) {
    this.require(p,'forensic.operations.alert.manage'); return this.repo.transition(p,id,a,r,u);
  }
  verifyAlert(p: ForensicPrincipal,id:string) {
    this.require(p,'forensic.operations.view'); return this.repo.verifyAlert(p,id);
  }
  snapshot(p: ForensicPrincipal) {
    this.require(p,'forensic.operations.view'); return this.repo.snapshot(p);
  }
  sla(p: ForensicPrincipal) {
    this.require(p,'forensic.operations.sla.evaluate'); return this.repo.evaluateSla(p);
  }
  report(p: ForensicPrincipal,i:ReportRequest) {
    this.require(p,'forensic.operations.executive_report');
    return this.repo.report(p,i,createHash('sha256').update(JSON.stringify(i)).digest('hex'));
  }
  reports(p: ForensicPrincipal) {
    this.require(p,'forensic.operations.view'); return this.repo.listReports(p);
  }
  createHandoff(p: ForensicPrincipal,i:Parameters<OperationsRepository['createHandoff']>[1]) {
    this.require(p,'forensic.operations.handoff'); return this.repo.createHandoff(p,i);
  }
  handoffs(p: ForensicPrincipal) {
    this.require(p,'forensic.operations.view'); return this.repo.listHandoffs(p);
  }
  attest(p: ForensicPrincipal,id:string,d:'ACCEPT'|'REJECT',n:string) {
    this.require(p,'forensic.operations.handoff'); return this.repo.attest(p,id,d,n);
  }
}
