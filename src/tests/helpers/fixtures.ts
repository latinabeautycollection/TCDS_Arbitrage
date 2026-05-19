import { randomUUID } from 'crypto';

export function makeProcessRunId() {
  return randomUUID();
}

export function makeCorrelationId() {
  return randomUUID();
}

export function makeIdempotencyKey(...parts: Array<string | number>) {
  return parts.map((part) => String(part)).join(':');
}

export function makeListingEvidenceJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    processRunId: makeProcessRunId(),
    processStepId: 1,
    entityType: 'candidate',
    entityPk: '1',
    correlationId: makeCorrelationId(),
    idempotencyKey: makeIdempotencyKey('listing', Date.now()),
    listingId: null,
    candidateId: null,
    ...overrides
  };
}

export function makeShippingEvidenceJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    processRunId: makeProcessRunId(),
    processStepId: 1,
    entityType: 'candidate',
    entityPk: '1',
    correlationId: makeCorrelationId(),
    idempotencyKey: makeIdempotencyKey('shipping', Date.now()),
    ...overrides
  };
}

export function makePricingEvidenceJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    processRunId: makeProcessRunId(),
    processStepId: 1,
    entityType: 'candidate',
    entityPk: '1',
    correlationId: makeCorrelationId(),
    idempotencyKey: makeIdempotencyKey('pricing', Date.now()),
    ...overrides
  };
}

export function makeLearningFeaturesJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    processRunId: makeProcessRunId(),
    processStepId: 1,
    entityType: 'candidate',
    entityPk: '1',
    correlationId: makeCorrelationId(),
    idempotencyKey: makeIdempotencyKey('learning', Date.now()),
    ...overrides
  };
}

export function makeFinalizeRunJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    processRunId: makeProcessRunId(),
    processStepId: 1,
    entityType: 'candidate',
    entityPk: '1',
    correlationId: makeCorrelationId(),
    idempotencyKey: makeIdempotencyKey('finalize', Date.now()),
    ...overrides
  };
}
