import type { OperationContext } from "../services/packShipApi";
import { createWarehouseClientOperation } from "../../../lib/scanning/workflow/operation/WarehouseClientOperation";

export interface BoundPackShipOperation<T> {
  readonly operation: OperationContext;
  readonly run: () => Promise<T>;
}

/**
 * Binds one manual/HID business submission to one logical operation identity. The returned
 * run closure may be retried after a timeout/network loss and will reuse clientOperationId
 * and correlationId while the HTTP helper generates a new X-Request-ID per attempt.
 */
export function bindPackShipManualOperation<T>(
  submit: (operation: OperationContext) => Promise<T>,
): BoundPackShipOperation<T> {
  const created = createWarehouseClientOperation();
  const operation: OperationContext = {
    clientOperationId: created.clientOperationId,
    correlationId: created.correlationId,
  };

  return Object.freeze({
    operation,
    run: () => submit(operation),
  });
}
