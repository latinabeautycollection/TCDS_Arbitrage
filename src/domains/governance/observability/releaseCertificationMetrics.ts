import{Counter,Histogram}from'prom-client';
const gates=new Counter({name:'domain11k_gate_results_total',help:'11K certification gate results',labelNames:['family','result']});
const replay=new Counter({name:'domain11k_replay_results_total',help:'11K replay results',labelNames:['result']});
const releases=new Counter({name:'domain11k_release_results_total',help:'11K release certification results',labelNames:['phase','status']});
const latency=new Histogram({name:'domain11k_operation_duration_seconds',help:'11K operation latency',labelNames:['operation']});
export const releaseCertificationMetrics={gate:(family:string,result:string)=>gates.inc({family,result}),replay:(result:string)=>replay.inc({result}),release:(phase:string,status:string)=>releases.inc({phase,status}),observe:(op:string,sec:number)=>latency.observe({operation:op},sec)};
