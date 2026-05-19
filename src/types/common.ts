export type ActorType = 'user' | 'worker' | 'system' | 'api' | 'service_account';

export interface ActorContext {
  actorType: ActorType;
  actorId?: string | null;
  actorName?: string | null;
  workerName?: string | null;
  workerInstanceId?: string | null;
}

export interface CorrelationContext {
  correlationId?: string | null;
  causationId?: string | null;
  idempotencyKey?: string | null;
}

export interface EntityRef {
  entityType: string;
  entityPk: string;
}

export type JsonObject = Record<string, unknown>;
