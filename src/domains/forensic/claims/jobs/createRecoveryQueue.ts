import type{Queue,Worker,Job}from'bullmq';import type{Pool}from'pg';import{RECOVERY_QUEUE,type RecoveryJob}from'./recoveryJobs';
import{createRecoveryProcessor}from'../workers/recoveryWorker';export interface Factory{createQueue(name:string):Queue;createWorker<T>(name:string,p:(j:Job<T>)=>Promise<void>):Worker<T>}
export function createRecoveryQueueRuntime(pool:Pool,f:Factory){return{queue:f.createQueue(RECOVERY_QUEUE),worker:f.createWorker<RecoveryJob>(RECOVERY_QUEUE,createRecoveryProcessor(pool))}}
