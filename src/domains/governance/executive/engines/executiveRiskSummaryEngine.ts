export interface ExecutiveRiskSummary { unknownSources:number; staleSources:number; contradictorySources:number; failedEnforcement:boolean; releaseMismatch:boolean; }
export class ExecutiveRiskSummaryEngine { summarize(envelopes:readonly any[],now=new Date()):ExecutiveRiskSummary{return{
 unknownSources:envelopes.filter(e=>e?.state==='UNKNOWN').length,staleSources:envelopes.filter(e=>new Date(e?.freshUntil??0)<=now).length,
 contradictorySources:envelopes.filter(e=>e?.contradictory===true).length,failedEnforcement:envelopes.some(e=>e?.slice==='11J'&&e?.details?.criticalEnforcementFailure===true),
 releaseMismatch:envelopes.some(e=>e?.slice==='11K'&&e?.details?.activeReleaseMatchesCertifiedRelease===false)}} }
