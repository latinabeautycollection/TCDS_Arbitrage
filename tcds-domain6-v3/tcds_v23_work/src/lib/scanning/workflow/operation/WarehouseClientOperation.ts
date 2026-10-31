export interface WarehouseClientOperation {
  clientOperationId: string;
  correlationId: string;
  createdAt: string;
}

export interface OperationRequestContext {
  clientOperationId: string;
  correlationId: string;
}

export function createWarehouseClientOperation(): WarehouseClientOperation {
  return {
    clientOperationId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
}

/**
 * A retry MUST reuse the same object. Only X-Request-ID is regenerated
 * per transport attempt.
 */
export function operationHeaders(
  operation: OperationRequestContext,
  requestId = crypto.randomUUID(),
): HeadersInit {
  return {
    "X-Request-ID": requestId,
    "X-Correlation-ID": operation.correlationId,
    "Idempotency-Key": operation.clientOperationId,
    "X-TCDS-Workflow-Contract": "6.2D.2",
  };
}
