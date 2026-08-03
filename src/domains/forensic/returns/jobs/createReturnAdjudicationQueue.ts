import type { Queue,Worker,Job } from 'bullmq';
import type { Pool } from 'pg';
import { RETURN_ADJUDICATION_QUEUE,type ReturnAdjudicationJob } from './returnAdjudicationJobs';
import { createReturnAdjudicationProcessor } from '../workers/returnAdjudicationWorker';
export interface RepositoryQueueFactory{createQueue(name:string):Queue;createWorker<T>(name:string,processor:(job:Job<T>)=>Promise<void>):Worker<T>}
export function createReturnAdjudicationQueueRuntime(pool:Pool,factory:RepositoryQueueFactory){
 return{queue:factory.createQueue(RETURN_ADJUDICATION_QUEUE),
 worker:factory.createWorker<ReturnAdjudicationJob>(RETURN_ADJUDICATION_QUEUE,createReturnAdjudicationProcessor(pool))};
}
