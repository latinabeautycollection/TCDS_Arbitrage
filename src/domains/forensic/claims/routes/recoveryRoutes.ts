import{Router,type NextFunction,type Request,type Response}from'express';import{z}from'zod';
import type{ClaimsPrincipal}from'../models/claimsTypes';import{ClaimsForensicError}from'../errors/ClaimsForensicError';
import{RecoveryService}from'../services/recoveryService';
interface R extends Request{claimsPrincipal?:ClaimsPrincipal;correlationId?:string}
const uuid=z.string().uuid(),key=z.string().min(8).max(250),sha=z.string().regex(/^[0-9a-f]{64}$/);
const open=z.object({chainId:uuid,externalDisputeId:z.string().min(2),disputeType:z.string().min(2),
 ebayOrderId:z.string().regex(/^\d+$/).optional(),ebayListingId:z.string().regex(/^\d+$/).optional(),
 arbShipmentId:z.string().regex(/^\d+$/).optional(),claimCaseLinkId:uuid.optional(),
 returnIntakeLinkId:uuid.optional(),fraudAssessmentId:uuid.optional(),disputedAmount:z.number().nonnegative(),
 openedAt:z.string().datetime(),responseDeadline:z.string().datetime().optional(),idempotencyKey:key,
 metadata:z.record(z.string(),z.unknown()).optional()});
const response=z.object({evidencePackageId:uuid,responseChannel:z.string().min(2),
 requestSha256:sha,responseSha256:sha,confirmationArtifactId:uuid,submittedAt:z.string().datetime(),
 idempotencyKey:key});
const recovery=z.object({claimCaseLinkId:uuid.optional(),recoverySource:z.string().min(2),
 externalTransactionId:z.string().min(2),transactionType:z.enum(['PAYMENT','CREDIT','REVERSAL','FEE',
 'DEDUCTIBLE','WRITE_OFF','ADJUSTMENT']),originalRecoveryTransactionId:uuid.optional(),
 amount:z.number(),currencyCode:z.string().length(3),occurredAt:z.string().datetime(),
 payloadSha256:sha,idempotencyKey:key});
const reconcile=z.object({claimCaseLinkId:uuid.optional(),cutoffAt:z.string().datetime(),
 policyVersion:z.string().min(2),idempotencyKey:key});
const learning=z.object({assessmentId:uuid,entityType:z.string().min(2),entityPk:z.string().min(1),
 featureGroup:z.string().min(2),featurePayload:z.record(z.string(),z.unknown()),idempotencyKey:key});
export function createRecoveryRouter(s:RecoveryService){const r=Router();
 r.post('/disputes',wrap(async(q,x)=>x.status(201).json({ok:true,data:await s.open(p(q),open.parse(q.body),q.correlationId)})));
 r.get('/disputes/:id',wrap(async(q,x)=>x.json({ok:true,data:await s.get(p(q),param(q,'id'))})));
 r.post('/disputes/:id/evidence-packages',wrap(async(q,x)=>{const b=z.object({idempotencyKey:key}).parse(q.body);x.status(201).json({ok:true,data:await s.build(p(q),param(q,'id'),b.idempotencyKey,q.correlationId)})}));
 r.post('/disputes/:id/responses',wrap(async(q,x)=>x.status(201).json({ok:true,data:await s.respond(p(q),{disputeCaseLinkId:param(q,'id'),...response.parse(q.body)},q.correlationId)})));
 r.post('/disputes/:id/recoveries',wrap(async(q,x)=>x.status(201).json({ok:true,data:await s.recovery(p(q),{disputeCaseLinkId:param(q,'id'),...recovery.parse(q.body)},q.correlationId)})));
 r.post('/disputes/:id/reconcile',wrap(async(q,x)=>{const b=reconcile.parse(q.body);x.status(201).json({ok:true,data:await s.reconcile(p(q),{disputeCaseLinkId:param(q,'id'),claimCaseLinkId:b.claimCaseLinkId,cutoffAt:b.cutoffAt,policyVersion:b.policyVersion},b.idempotencyKey,q.correlationId)})}));
 r.post('/disputes/:id/learning-exports',wrap(async(q,x)=>x.status(201).json({ok:true,data:await s.exportLearning(p(q),learning.parse(q.body),q.correlationId)})));
 r.use((e:unknown,_q:Request,x:Response,n:NextFunction)=>{if(e instanceof ClaimsForensicError){x.status(e.status).json({ok:false,error:e.code,message:e.message});return}if(e instanceof z.ZodError){x.status(400).json({ok:false,error:'VALIDATION_ERROR',issues:e.issues});return}n(e)});return r}
function p(q:R){if(!q.claimsPrincipal)throw new ClaimsForensicError('UNAUTHENTICATED','Authentication required',401);return q.claimsPrincipal}
function param(q:R,n:string):string{const raw=q.params[n];const v=Array.isArray(raw)?raw[0]:raw;if(!v)throw new ClaimsForensicError('INVALID_PATH','Missing path parameter',400);return v}
function wrap(f:(q:R,x:Response,n:NextFunction)=>Promise<unknown>){return(q:R,x:Response,n:NextFunction):void=>{void f(q,x,n).catch(n)}}
