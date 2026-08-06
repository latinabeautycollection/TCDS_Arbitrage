export interface Counter{inc(labels?:Record<string,string>,value?:number):void}
export interface Histogram{observe(labels:Record<string,string>,value:number):void}
export class AccessMetrics{constructor(private readonly decisions:Counter,private readonly latency:Histogram){}
 record(result:string,source:string,durationMs:number){const labels={result,source};this.decisions.inc(labels);this.latency.observe(labels,durationMs/1000)}}
