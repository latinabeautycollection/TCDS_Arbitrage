import { Counter,Histogram,register } from 'prom-client';
import type { CapitalSafetyMetrics } from './capitalSafetyObservability';

type CounterLike={inc:(labels?:Record<string,string>,value?:number)=>void};
type HistogramLike={observe:(labels:Record<string,string>,value:number)=>void};
function counter(name:string,help:string,labelNames:string[]):CounterLike{
  const existing=register.getSingleMetric(name) as CounterLike|undefined;
  return existing??(new Counter({name,help,labelNames}) as unknown as CounterLike);
}
function histogram(name:string,help:string,labelNames:string[]):HistogramLike{
  const existing=register.getSingleMetric(name) as HistogramLike|undefined;
  return existing??new Histogram({name,help,labelNames});
}
export function createCapitalSafetyPrometheusMetrics():CapitalSafetyMetrics{
  const assessments=counter('domain11f_assessment_total','Domain 11F capital safety assessments',['state']);
  const rejections=counter('domain11f_rejection_total','Domain 11F rejected/failed assessment attempts',['reason']);
  const duration=histogram('domain11f_assessment_duration_seconds','Domain 11F assessment duration in seconds',['outcome']);
  return {
    assessment:(state)=>assessments.inc({state}),
    rejection:(reason)=>rejections.inc({reason}),
    duration:(seconds,outcome)=>duration.observe({outcome},seconds)
  };
}
