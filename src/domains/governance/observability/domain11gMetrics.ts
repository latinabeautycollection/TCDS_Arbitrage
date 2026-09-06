import { Counter,Histogram,Gauge,register } from 'prom-client';
import { FORBIDDEN_METRIC_LABELS } from '../constants/observabilityConstants';
const LABELS=['domain','observation_type','outcome','severity'] as const;
export class Domain11gMetrics{
  private readonly observation=new Counter({name:'domain11g_observation_total',help:'11G normalized observations',labelNames:LABELS,registers:[register]});
  private readonly rejection=new Counter({name:'domain11g_ingest_rejection_total',help:'11G ingestion rejections',labelNames:['reason'],registers:[register]});
  private readonly correlation=new Counter({name:'domain11g_correlation_total',help:'11G correlation queries',labelNames:['query_type','outcome'],registers:[register]});
  private readonly orphan=new Counter({name:'domain11g_orphan_observation_total',help:'11G observations without subject component',labelNames:['domain'],registers:[register]});
  private readonly outOfOrder=new Counter({name:'domain11g_out_of_order_observation_total',help:'11G late observations',labelNames:['domain'],registers:[register]});
  private readonly ingestDuration=new Histogram({name:'domain11g_ingest_duration_seconds',help:'11G ingest latency',labelNames:['outcome'],registers:[register]});
  private readonly queryDuration=new Histogram({name:'domain11g_query_duration_seconds',help:'11G query latency',labelNames:['query_type','outcome'],registers:[register]});
  private readonly active?:Gauge;private readonly retention?:Counter;
  constructor(workerProcess=false){if(workerProcess){this.active=new Gauge({name:'domain11g_active_correlations',help:'Distinct correlations observed in the governed active window',registers:[register]});this.retention=new Counter({name:'domain11g_retention_deletions_total',help:'11G retention deletions',registers:[register]});}}
  recorded(domain:string,type:string,outcome:string,severity:string){this.observation.inc({domain,observation_type:type,outcome,severity});}rejected(reason:string){this.rejection.inc({reason});}
  correlationQuery(type:string,outcome:string){this.correlation.inc({query_type:type,outcome});}orphaned(domain:string){this.orphan.inc({domain});}late(domain:string){this.outOfOrder.inc({domain});}
  observeIngest(seconds:number,outcome:string){this.ingestDuration.observe({outcome},seconds);}observeQuery(seconds:number,type:string,outcome:string){this.queryDuration.observe({query_type:type,outcome},seconds);}
  setActive(n:number){if(!this.active)throw new Error('WORKER_METRIC_NOT_REGISTERED');this.active.set(n);}retained(n:number){if(!this.retention)throw new Error('WORKER_METRIC_NOT_REGISTERED');this.retention.inc(n);}
}
export function assertMetricCardinalityContract():void{for(const label of LABELS){if(FORBIDDEN_METRIC_LABELS.has(label))throw new Error(`HIGH_CARDINALITY_LABEL_FORBIDDEN:${label}`);}}
let apiSingleton:Domain11gMetrics|undefined;export function getDomain11gMetrics():Domain11gMetrics{return apiSingleton??(apiSingleton=new Domain11gMetrics(false));}
