import{randomUUID}from'node:crypto';import type{ReliabilityService}from'../services/reliabilityService';import type{ReliabilityPrincipal}from'../models/reliabilityTypes';
export interface ScheduledSlo{sloDefinitionId:string}
export interface ScheduledDrift{baselineId:string;windowSeconds:number}
export class ReliabilityEvaluationWorker{
 constructor(private readonly service:ReliabilityService,private readonly principal:ReliabilityPrincipal){}
 async tick(input:{slos:ScheduledSlo[];drifts:ScheduledDrift[];evaluationAt?:Date}){const at=input.evaluationAt??new Date();
  for(const x of input.slos){const requestId=randomUUID(),correlationId=randomUUID();await this.service.evaluateSlo(this.principal,{sloDefinitionId:x.sloDefinitionId,evaluationAt:at,idempotencyKey:`11i-v2:slo:${x.sloDefinitionId}:${at.toISOString()}`,requestId,correlationId},true)}
  for(const x of input.drifts){const requestId=randomUUID(),correlationId=randomUUID();await this.service.evaluateDrift(this.principal,{baselineId:x.baselineId,evaluationAt:at,windowSeconds:x.windowSeconds,idempotencyKey:`11i-v2:drift:${x.baselineId}:${x.windowSeconds}:${at.toISOString()}`,requestId,correlationId},true)}
 }}
