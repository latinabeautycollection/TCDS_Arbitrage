import { Counter,Histogram,register } from 'prom-client';
export interface KpiLogger{info(message:string,meta?:Record<string,unknown>):void;warn(message:string,meta?:Record<string,unknown>):void;error(message:string,meta?:Record<string,unknown>):void;}
export interface KpiMetrics{calculated(code:string,state:string):void;duration(seconds:number,code:string):void;}
export class Domain11hMetrics implements KpiMetrics{
 private readonly total=new Counter({name:'domain11h_metric_calculation_total',help:'11H KPI calculations',labelNames:['metric_code','metric_state'],registers:[register]});
 private readonly seconds=new Histogram({name:'domain11h_metric_calculation_duration_seconds',help:'11H KPI calculation duration',labelNames:['metric_code'],registers:[register]});
 calculated(code:string,state:string){this.total.inc({metric_code:code,metric_state:state});}
 duration(s:number,code:string){this.seconds.observe({metric_code:code},s);}
}
let singleton:Domain11hMetrics|undefined;export function getDomain11hMetrics(){return singleton??(singleton=new Domain11hMetrics());}
