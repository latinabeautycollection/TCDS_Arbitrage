import{Router,type NextFunction,type Request,type Response}from'express';import{z}from'zod';
import type{ClaimsPrincipal}from'../models/claimsTypes';import{ClaimsForensicError}from'../errors/ClaimsForensicError';
import{ClaimsService}from'../services/claimsService';
interface R extends Request{claimsPrincipal?:ClaimsPrincipal;correlationId?:string}
const uuid=z.string().uuid(),key=z.string().min(8).max(250),sha=z.string().regex(/^[0-9a-f]{64}$/);
const open=z.object({chainId:uuid,claimCaseId:uuid,returnIntakeLinkId:uuid.optional(),
 adjudicationGateId:uuid.optional(),shippingCustodyLinkId:uuid.optional(),
 arbShipmentId:z.string().regex(/^\d+$/).optional(),ebayOrderId:z.string().regex(/^\d+$/).optional(),
 idempotencyKey:key,metadata:z.record(z.string(),z.unknown()).optional()});
const evidence=z.object({evidenceRole:z.string().min(2).max(100),forensicArtifactId:uuid.optional(),
 warehouseClaimEvidenceId:uuid.optional(),retailEvidenceArtifactId:uuid.optional(),
 retailProductId:uuid.optional(),retailOfferSnapshotId:uuid.optional(),required:z.boolean(),
 idempotencyKey:key,metadata:z.record(z.string(),z.unknown()).optional()}).superRefine((v,ctx)=>{
  const n=[v.forensicArtifactId,v.warehouseClaimEvidenceId,v.retailEvidenceArtifactId].filter(Boolean).length;
  if(n!==1)ctx.addIssue({code:'custom',message:'Exactly one evidence source is required'});
 });
const filing=z.object({readinessAssessmentId:uuid,externalClaimId:z.string().min(2).max(200),
 filingChannel:z.string().min(2).max(100),requestPayloadSha256:sha,responsePayloadSha256:sha,
 confirmationArtifactId:uuid,filedAmount:z.number().nonnegative(),filedAt:z.string().datetime(),idempotencyKey:key});
export function createClaimsRouter(s:ClaimsService){const r=Router();
 r.post('/claims',wrap(async(q,x)=>x.status(201).json({ok:true,data:await s.open(p(q),open.parse(q.body),q.correlationId)})));
 r.get('/claims/:id',wrap(async(q,x)=>x.json({ok:true,data:await s.get(p(q),param(q,'id'))})));
 r.post('/claims/:id/evidence',wrap(async(q,x)=>x.status(201).json({ok:true,data:await s.linkEvidence(p(q),{claimCaseLinkId:param(q,'id'),...evidence.parse(q.body)},q.correlationId)})));
 r.post('/claims/:id/deadline-assessments',wrap(async(q,x)=>{const b=z.object({idempotencyKey:key}).parse(q.body);x.status(201).json({ok:true,data:await s.assessDeadline(p(q),param(q,'id'),b.idempotencyKey,q.correlationId)})}));
 r.post('/claims/:id/evaluate',wrap(async(q,x)=>{const b=z.object({idempotencyKey:key}).parse(q.body);const d=await s.evaluate(p(q),param(q,'id'),b.idempotencyKey,q.correlationId);x.status(d.result==='READY'?200:409).json({ok:d.result==='READY',data:d})}));
 r.post('/claims/:id/filings',wrap(async(q,x)=>x.status(201).json({ok:true,data:await s.file(p(q),{claimCaseLinkId:param(q,'id'),...filing.parse(q.body)},q.correlationId)})));
 r.use((e:unknown,_q:Request,x:Response,n:NextFunction)=>{if(e instanceof ClaimsForensicError){x.status(e.status).json({ok:false,error:e.code,message:e.message});return}if(e instanceof z.ZodError){x.status(400).json({ok:false,error:'VALIDATION_ERROR',issues:e.issues});return}n(e)});return r}
function p(q:R){if(!q.claimsPrincipal)throw new ClaimsForensicError('UNAUTHENTICATED','Authentication required',401);return q.claimsPrincipal}
function param(q:R,n:string):string{const raw=q.params[n];const v=Array.isArray(raw)?raw[0]:raw;if(!v)throw new ClaimsForensicError('INVALID_PATH','Missing path parameter',400);return v}
function wrap(f:(q:R,x:Response,n:NextFunction)=>Promise<unknown>){return(q:R,x:Response,n:NextFunction):void=>{void f(q,x,n).catch(n)}}
