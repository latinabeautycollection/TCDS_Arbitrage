import { Queue } from 'bullmq'; import type { RedisOptions } from 'ioredis';
export const FORENSIC_STORAGE_QUEUE='domain7-forensic-storage';
export type ForensicStorageJob={name:'verify-artifact';artifactId:string;actorId:string;correlationId?:string}|{name:'reconcile-storage';prefix:string;correlationId?:string};
export function createForensicStorageQueue(connection:RedisOptions){return new Queue<ForensicStorageJob>(FORENSIC_STORAGE_QUEUE,{connection,defaultJobOptions:{attempts:5,backoff:{type:'exponential',delay:5000},removeOnComplete:{age:86400,count:10000},removeOnFail:false}});}
