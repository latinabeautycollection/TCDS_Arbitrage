import { Router,type RequestHandler } from 'express';
import { certificationRequestSchema,revocationRequestSchema,snapshotRequestSchema } from '../validators/executiveValidators';
import { actorFromRequest,requireExecutivePermission,type TrustedPrincipalResolver } from '../auth/executiveAuthorization';
import type { ExecutiveGovernanceService } from '../services/executiveGovernanceService'; import type { Phase3CertificationService } from '../services/phase3CertificationService';
export function createExecutiveGovernanceRouter(d:{governance:ExecutiveGovernanceService;certification:Phase3CertificationService;principalResolver:TrustedPrincipalResolver}):Router{
 const r=Router(); const read=requireExecutivePermission(d.principalResolver,'governance.executive.read');
 r.get('/summary',read,async(_q,res,next)=>{try{res.json(await d.governance.summary())}catch(e){next(e)}});
 r.get('/certification',read,async(_q,res,next)=>{try{res.json({certification:await d.governance.certification()})}catch(e){next(e)}});
 r.get('/certification/epoch',read,async(_q,res,next)=>{try{res.json({epoch:await d.governance.epoch()})}catch(e){next(e)}});
 // Sub-summary endpoints intentionally use the same authoritative snapshot; they do not recalculate upstream truth.
 for(const p of ['domains','health','readiness','policies','capital','accountability','controls','kpis','reliability','releases'])
  r.get('/'+p,read,async(_q,res,next)=>{try{const s=await d.governance.summary();res.json({section:p,snapshotId:s.snapshotId,executiveState:s.currentExecutiveGovernanceState,summary:s})}catch(e){next(e)}});
 r.post('/snapshots',requireExecutivePermission(d.principalResolver,'governance.executive.snapshot'),async(q,res,next)=>{try{const body=snapshotRequestSchema.parse(q.body);const id=await d.governance.createSnapshot(actorFromRequest(q),body.idempotencyKey,body.evidenceCutoffAt);res.status(201).json({snapshotId:id})}catch(e){next(e)}});
 r.post('/phase3-certification',requireExecutivePermission(d.principalResolver,'governance.executive.certify'),async(q,res,next)=>{try{const body=certificationRequestSchema.parse(q.body);const out=await d.certification.certify(actorFromRequest(q),body);res.status(out.outcome==='CERTIFIED_COMPLETE'||out.outcome==='CERTIFIED_WITH_RESTRICTIONS'?201:409).json(out)}catch(e){next(e)}});
 r.post('/phase3-certification/:id/revoke',requireExecutivePermission(d.principalResolver,'governance.executive.revoke'),async(q,res,next)=>{try{const body=revocationRequestSchema.parse(q.body);const id=q.params.id;if(!id)throw new Error('Missing certification id');const out=await d.certification.revoke(actorFromRequest(q),String(id),body);res.status(201).json({revocationId:out})}catch(e){next(e)}});
 return r;
}
