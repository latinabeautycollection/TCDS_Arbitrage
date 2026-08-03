import type { Queue,Worker,Job } from 'bullmq';
import type { Pool } from 'pg';
import { RETURN_INTAKE_QUEUE,type ReturnIntakeJob } from './returnIntakeJobs';
import { createReturnIntakeProcessor } from '../workers/returnIntakeWorker';

export interface RepositoryQueueFactory {
 createQueue(name:string):Queue;
 createWorker<T>(name:string,processor:(job:Job<T>)=>Promise<void>):Worker<T>;
}
export function createReturnIntakeQueueRuntime(pool:Pool,factory:RepositoryQueueFactory){
 const queue=factory.createQueue(RETURN_INTAKE_QUEUE);
 const worker=factory.createWorker<ReturnIntakeJob>(RETURN_INTAKE_QUEUE,createReturnIntakeProcessor(pool));
 return {queue,worker};
}
