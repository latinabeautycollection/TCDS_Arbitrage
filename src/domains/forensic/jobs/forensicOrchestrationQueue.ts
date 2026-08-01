import type{Queue}from'bullmq';import type{ManifestBuildJob}from'../models/orchestrationTypes';
export const FORENSIC_ORCHESTRATION_QUEUE='domain7-forensic-orchestration';
export class ForensicOrchestrationQueue{constructor(private readonly queue:Queue<ManifestBuildJob>){}async enqueueManifest(job:ManifestBuildJob){return this.queue.add('build-manifest',job,{jobId:`d7-manifest-${job.manifestRequestId}`,attempts:5,backoff:{type:'exponential',delay:5000},removeOnComplete:1000,removeOnFail:false});}}
