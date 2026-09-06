import type { ExecutiveGovernanceState } from '../models/executiveGovernanceTypes';
export interface AuthorityEnvelope { slice:string; certificationState:string; state:string; authoritative:boolean; contradictory:boolean; freshUntil:string; details:Readonly<Record<string,unknown>>; }
export class ExecutiveTruthAggregationEngine {
 // This engine never invents upstream truth. It applies only aggregate safety invariants; policy-specific materiality remains 11D-owned.
 classify(envelopes:readonly AuthorityEnvelope[], now=new Date()):ExecutiveGovernanceState{
  if(envelopes.length!==11)return 'UNKNOWN';
  if(envelopes.some(e=>!e.authoritative||e.contradictory||Number.isNaN(Date.parse(e.freshUntil))))return 'UNKNOWN';
  if(envelopes.some(e=>new Date(e.freshUntil)<=now||e.certificationState!=='CERTIFIED'||e.state==='UNKNOWN'))return 'UNKNOWN';
  const j=envelopes.find(e=>e.slice==='11J'); const k=envelopes.find(e=>e.slice==='11K');
  if(j?.details.criticalEnforcementFailure===true||k?.details.activeReleaseMatchesCertifiedRelease===false)return 'BLOCKED';
  if(envelopes.some(e=>['BLOCKED','CRITICAL'].includes(e.state)))return 'BLOCKED';
  if(envelopes.some(e=>e.state==='RESTRICTED'))return 'RESTRICTED';
  if(envelopes.some(e=>e.state==='DEGRADED'))return 'DEGRADED';
  return 'GREEN';
 }
}
