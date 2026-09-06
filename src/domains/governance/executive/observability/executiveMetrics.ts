import { Counter,Histogram,Gauge,Registry } from 'prom-client';
export class ExecutiveMetrics {
 readonly snapshotTotal:Counter; readonly snapshotDuration:Histogram; readonly certificationTotal:Counter; readonly certificationFailure:Counter; readonly revocationTotal:Counter; readonly activeRestrictions:Gauge;
 constructor(registry:Registry){
  const mk=(name:string,help:string)=>{const existing=registry.getSingleMetric(name);return existing};
  this.snapshotTotal=(mk('domain11l_snapshot_total','') as Counter)||new Counter({name:'domain11l_snapshot_total',help:'Executive snapshots',registers:[registry]});
  this.snapshotDuration=(mk('domain11l_snapshot_duration_seconds','') as Histogram)||new Histogram({name:'domain11l_snapshot_duration_seconds',help:'Snapshot duration',registers:[registry]});
  this.certificationTotal=(mk('domain11l_phase3_certification_total','') as Counter)||new Counter({name:'domain11l_phase3_certification_total',help:'Phase 3 certification attempts',labelNames:['outcome'],registers:[registry]});
  this.certificationFailure=(mk('domain11l_certification_failure_total','') as Counter)||new Counter({name:'domain11l_certification_failure_total',help:'Certification failures',labelNames:['reason'],registers:[registry]});
  this.revocationTotal=(mk('domain11l_certification_revocation_total','') as Counter)||new Counter({name:'domain11l_certification_revocation_total',help:'Certification revocations',labelNames:['reason'],registers:[registry]});
  this.activeRestrictions=(mk('domain11l_active_restrictions','') as Gauge)||new Gauge({name:'domain11l_active_restrictions',help:'Current executive restrictions',registers:[registry]});
 }
}
