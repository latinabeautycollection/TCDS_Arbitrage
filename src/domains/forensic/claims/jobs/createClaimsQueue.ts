import type{Queue,Worker,Job}from'bullmq';import type{Pool}from'pg';import{CLAIMS_QUEUE,type ClaimsJob}from'./claimsJobs';
import{createClaimsProcessor}from'../workers/claimsWorker';export interface Factory{createQueue(name:string):Queue;createWorker<T>(name:string,p:(j:Job<T>)=>Promise<void>):Worker<T>}
export function createClaimsQueueRuntime(pool:Pool,f:Factory){return{queue:f.createQueue(CLAIMS_QUEUE),worker:f.createWorker<ClaimsJob>(CLAIMS_QUEUE,createClaimsProcessor(pool))}}
