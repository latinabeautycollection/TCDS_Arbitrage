import type { Job } from 'bullmq';
import type { OperationsService } from '../services/operationsService';
export interface GovernedWorkerFactory {
  create<T>(name:string,handler:(job:Job<T>)=>Promise<unknown>,options:{concurrency:number}):unknown;
}
export interface PersistedPrincipalResolver {
  resolve(processRunId:string):Promise<import('../models/operationsTypes').ForensicPrincipal>;
}
interface JobData { readonly processRunId:string; }
export function registerOperationsWorkers(
  factory:GovernedWorkerFactory,resolver:PersistedPrincipalResolver,service:OperationsService,
) {
  return [
    factory.create<JobData>('domain7-operations-monitor',
      async job=>service.sla(await resolver.resolve(job.data.processRunId)),{concurrency:1}),
    factory.create<JobData>('domain7-command-snapshot',
      async job=>service.snapshot(await resolver.resolve(job.data.processRunId)),{concurrency:1}),
  ];
}
