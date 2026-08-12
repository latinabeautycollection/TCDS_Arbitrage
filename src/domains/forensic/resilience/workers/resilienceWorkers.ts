import type { Job } from 'bullmq';
export interface GovernedWorkerFactory {
  create<T>(name:string,handler:(job:Job<T>)=>Promise<unknown>,options:{concurrency:number}):unknown;
}
export interface PersistedPrincipalResolver {
  resolveForProcessRun(processRunId:string):Promise<import('../models/resilienceTypes').ForensicPrincipal>;
}
export function registerResilienceWorkers(factory:GovernedWorkerFactory) {
  return {
    register<T>(name:string,handler:(job:Job<T>)=>Promise<unknown>,concurrency=1) {
      return factory.create(name,handler,{concurrency});
    }
  };
}
