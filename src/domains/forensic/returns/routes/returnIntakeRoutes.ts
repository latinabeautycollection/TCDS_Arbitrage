import { Router,type NextFunction,type Request,type Response } from 'express';
import { z } from 'zod';
import type { ReturnPrincipal } from '../models/returnEvidenceTypes';
import { ReturnForensicError } from '../errors/ReturnForensicError';
import { ReturnIntakeService } from '../services/returnIntakeService';

interface R extends Request { returnPrincipal?:ReturnPrincipal; correlationId?:string }
const key=z.string().min(8).max(250);
const uuid=z.string().uuid();
const open=z.object({chainId:uuid,returnCaseId:uuid,returnSessionId:uuid,
 outboundPackageId:uuid.optional(),shippingCustodyLinkId:uuid.optional(),
 arbShipmentId:z.string().regex(/^\d+$/).optional(),idempotencyKey:key,
 metadata:z.record(z.string(),z.unknown()).optional()});
const artifact=z.object({artifactId:uuid,evidenceRole:z.string().min(2).max(100),
 warehouseMediaAssetId:uuid.optional(),sequenceNo:z.number().int().positive(),
 idempotencyKey:key,metadata:z.record(z.string(),z.unknown()).optional()});
const pkg=z.object({inspectionId:uuid,artifactLinkIds:z.array(uuid).min(1),idempotencyKey:key});
const component=z.object({expectedComponentId:uuid.optional(),componentName:z.string().min(1).max(200),
 receivedQuantity:z.number().int().nonnegative(),conditionResult:z.string().max(100).optional(),
 observedIdentityHmac:z.string().max(256).optional(),artifactLinkIds:z.array(uuid).min(1),idempotencyKey:key});
const identity=z.object({returnItemId:uuid,identifierType:z.string().min(2).max(50),
 observedHmac:z.string().max(256).optional(),maskedObservedValue:z.string().min(2).max(150),
 artifactLinkId:uuid,method:z.enum(['BARCODE_SCAN','OCR','MANUAL_DUAL_ATTESTATION','DEVICE_QUERY']),
 secondUserId:uuid.optional(),barcodeScanEventId:z.string().regex(/^\d+$/).optional(),
 observedAt:z.string().datetime(),idempotencyKey:key});
const exception=z.object({reason:z.string().min(5).max(1000),
 details:z.record(z.string(),z.unknown()).default({}),idempotencyKey:key});
const decision=z.object({decision:z.enum(['APPROVED','REJECTED','REMEDIATION_REQUIRED']),
 warehouseOverrideId:uuid.optional(),reason:z.string().min(10).max(2000),
 supersedesDecisionId:uuid.optional(),idempotencyKey:key});

export function createReturnIntakeRouter(service:ReturnIntakeService):Router{
 const r=Router();
 r.post('/intake',wrap(async(q,x)=>{const data=await service.open(principal(q),open.parse(q.body),q.correlationId);x.status(201).json({ok:true,data})}));
 r.get('/intake/:id',wrap(async(q,x)=>{const id=requiredParam(q,'id');x.json({ok:true,data:await service.get(principal(q),id)})}));
 r.post('/intake/:id/artifacts',wrap(async(q,x)=>{const data=await service.linkArtifact(principal(q),{linkId:requiredParam(q,'id'),...artifact.parse(q.body)},q.correlationId);x.status(201).json({ok:true,data})}));
 r.post('/intake/:id/package-inspections',wrap(async(q,x)=>{const data=await service.recordPackage(principal(q),{linkId:requiredParam(q,'id'),...pkg.parse(q.body)},q.correlationId);x.status(201).json({ok:true,data})}));
 r.post('/intake/:id/components',wrap(async(q,x)=>{const data=await service.recordComponent(principal(q),{linkId:requiredParam(q,'id'),...component.parse(q.body)},q.correlationId);x.status(201).json({ok:true,data})}));
 r.post('/intake/:id/identities',wrap(async(q,x)=>{const data=await service.recordIdentity(principal(q),{linkId:requiredParam(q,'id'),...identity.parse(q.body)},q.correlationId);x.status(201).json({ok:true,data})}));
 r.post('/intake/:id/continuity-exceptions',wrap(async(q,x)=>{const data=await service.recordContinuityException(principal(q),{linkId:requiredParam(q,'id'),...exception.parse(q.body)},q.correlationId);x.status(201).json({ok:true,data})}));
 r.post('/intake/:id/continuity-decisions',wrap(async(q,x)=>{const data=await service.recordContinuityDecision(principal(q),{linkId:requiredParam(q,'id'),...decision.parse(q.body)},q.correlationId);x.status(201).json({ok:true,data})}));
 r.post('/intake/:id/evaluate',wrap(async(q,x)=>{const b=z.object({idempotencyKey:key}).parse(q.body);const data=await service.evaluate(principal(q),requiredParam(q,'id'),b.idempotencyKey,q.correlationId);x.status(data.result==='PASSED'?200:409).json({ok:data.result==='PASSED',data})}));
 r.use((e:unknown,_q:Request,x:Response,n:NextFunction)=>{if(e instanceof ReturnForensicError){x.status(e.status).json({ok:false,error:e.code,message:e.message,details:e.details});return}if(e instanceof z.ZodError){x.status(400).json({ok:false,error:'VALIDATION_ERROR',issues:e.issues});return}n(e)});
 return r;
}
function principal(q:R):ReturnPrincipal{if(!q.returnPrincipal)throw new ReturnForensicError('UNAUTHENTICATED','Authentication required',401);return q.returnPrincipal}
function requiredParam(q:R,name:string):string{const raw=q.params[name];const value=Array.isArray(raw)?raw[0]:raw;if(!value)throw new ReturnForensicError('INVALID_PATH','Missing path parameter',400);return value}
function wrap(f:(q:R,x:Response,n:NextFunction)=>Promise<void>){return(q:R,x:Response,n:NextFunction):void=>{void f(q,x,n).catch(n)}}
