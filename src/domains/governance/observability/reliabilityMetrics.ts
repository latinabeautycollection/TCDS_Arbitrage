import{Counter,Histogram}from'prom-client';
const evaluations=new Counter({name:'domain11i_evaluations_total',help:'Authoritative 11I evaluations',labelNames:['kind','outcome']});
const duration=new Histogram({name:'domain11i_evaluation_duration_seconds',help:'11I evaluation latency',labelNames:['kind']});
const baselines=new Counter({name:'domain11i_baselines_total',help:'11I governed baselines',labelNames:['authority','method']});
export interface ReliabilityMetrics{evaluated(kind:string,outcome:string):void;observe(kind:string,seconds:number):void;baseline(authority:string,method:string):void}
export const reliabilityMetrics:ReliabilityMetrics={
 evaluated:(kind,outcome)=>evaluations.inc({kind,outcome}),
 observe:(kind,seconds)=>duration.observe({kind},seconds),
 baseline:(authority,method)=>baselines.inc({authority,method})
};