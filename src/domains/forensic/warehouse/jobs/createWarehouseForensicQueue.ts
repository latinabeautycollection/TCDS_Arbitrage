import type { Queue, Worker } from 'bullmq';
import type { Pool } from 'pg';
import { WAREHOUSE_FORENSIC_QUEUE, type WarehouseForensicJob } from './warehouseForensicJobs';
import { createWarehouseForensicProcessor } from '../workers/warehouseForensicWorker';

export interface RepositoryQueueFactory {
  createQueue<T>(name:string):Queue<T>;
  createWorker<T>(name:string,processor:(job:any)=>Promise<void>):Worker<T>;
}

export function createWarehouseForensicQueueRuntime(
  pool:Pool,
  factory:RepositoryQueueFactory,
){
  const queue=factory.createQueue<WarehouseForensicJob>(WAREHOUSE_FORENSIC_QUEUE);
  const worker=factory.createWorker<WarehouseForensicJob>(
    WAREHOUSE_FORENSIC_QUEUE,
    createWarehouseForensicProcessor(pool),
  );
  return {queue,worker};
}
