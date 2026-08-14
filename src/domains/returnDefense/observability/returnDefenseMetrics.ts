
export interface Counter { inc(labels?:Record<string,string>,value?:number):void }
export interface Histogram { observe(labels:Record<string,string>,value:number):void }

export interface ReturnDefenseMetrics {
  decisions: Counter;
  blockedDecisions: Counter;
  staleInvalidations: Counter;
  replayDifferences: Counter;
  interventionClaims: Counter;
  assessmentDurationMs: Histogram;
}

export function noOpReturnDefenseMetrics():ReturnDefenseMetrics{
  const counter:Counter={inc:()=>undefined};
  const histogram:Histogram={observe:()=>undefined};
  return {
    decisions:counter,blockedDecisions:counter,staleInvalidations:counter,
    replayDifferences:counter,interventionClaims:counter,
    assessmentDurationMs:histogram,
  };
}
