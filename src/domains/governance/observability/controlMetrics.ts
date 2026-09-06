import{Counter,Histogram,Gauge}from'prom-client';
const decisions=new Counter({name:'domain11j_control_decisions_total',help:'11J control decisions',labelNames:['state','authority']});
const actions=new Counter({name:'domain11j_control_actions_total',help:'11J control action lifecycle',labelNames:['status','actionType']});
const recoveries=new Counter({name:'domain11j_recoveries_total',help:'11J recovery lifecycle',labelNames:['status']});
const failures=new Counter({name:'domain11j_failures_total',help:'11J processing failures',labelNames:['operation','code']});
const duration=new Histogram({name:'domain11j_operation_duration_seconds',help:'11J operation latency',labelNames:['operation']});
const active=new Gauge({name:'domain11j_effective_controls',help:'Current 11J effective controls by low-cardinality state',labelNames:['state']});
export interface ControlMetrics{
 decision(state:string,authority:string):void;action(status:string,actionType:string):void;
 recovery(status:string):void;failure(operation:string,code:string):void;observe(operation:string,seconds:number):void;
 setActive(state:string,value:number):void;
}
export const controlMetrics:ControlMetrics={
 decision:(state,authority)=>decisions.inc({state,authority}),
 action:(status,actionType)=>actions.inc({status,actionType}),
 recovery:status=>recoveries.inc({status}),
 failure:(operation,code)=>failures.inc({operation,code}),
 observe:(operation,seconds)=>duration.observe({operation},seconds),
 setActive:(state,value)=>active.set({state},value)
};