import { JsonObject } from './common';

export type ProcessRunStatus =
  | 'pending'
  | 'capturing_listing'
  | 'capturing_shipping'
  | 'capturing_pricing'
  | 'computing_learning'
  | 'finalized'
  | 'failed'
  | 'dead_lettered';

export type ProcessStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'dead_lettered';

export interface CreateProcessRunInput {
  phaseName: string;
  runType: string;
  entityType: string;
  entityPk: string;
  sourceTable?: string | null;
  sourcePk?: string | null;
  idempotencyKey: string;
  correlationId?: string | null;
  causationId?: string | null;
  initiatedByActorId?: number | null;
  metadata?: JsonObject;
}

export interface ForensicEventInput {
  processRunId: number;
  processStepId?: number | null;
  entityType: string;
  entityPk: string;
  eventName: string;
  actionType: string;
  queueName?: string | null;
  jobId?: string | null;
  workerName?: string | null;
  actorId?: number | null;
  correlationId?: string | null;
  causationId?: string | null;
  idempotencyKey?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  evidencePayload?: JsonObject;
  metricsPayload?: JsonObject;
  flags?: unknown[];
}
