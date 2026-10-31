import type { OperationRequestContext } from "../operation/WarehouseClientOperation";
import { operationHeaders } from "../operation/WarehouseClientOperation";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

async function request<T>(
  path: string,
  operation: OperationRequestContext,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...operationHeaders(operation),
      ...(init.headers || {}),
    },
  });
  if (response.status === 401) throw new Error("SESSION_EXPIRED");
  if (response.status === 409) throw new Error("CONFLICT");
  if (response.status === 412) throw new Error("STALE_VERSION");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.code || `HTTP_${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

export const productionWorkflowPorts = {
  receiving: {
    matchPackage(identifier: string, op: OperationRequestContext) {
      return request("/api/v1/receiving/packages/match", op, {
        method: "POST",
        body: JSON.stringify({ identifier }),
      });
    },
    submitItemScan(value: string, op: OperationRequestContext) {
      // The authoritative production receiving screen must supply candidate/session
      // state. This endpoint wrapper intentionally does not invent a new receiving
      // state transition. It routes to the existing scan/candidate integration
      // endpoint added during V2.2 merge.
      return request("/api/v1/receiving/scan-observation", op, {
        method: "POST",
        body: JSON.stringify({ value }),
      });
    },
  },

  putaway: {
    scanItem(sessionId: string, barcode: string, rowVersion: number, op: OperationRequestContext) {
      return request(`/api/v1/put-away/sessions/${encodeURIComponent(sessionId)}/scan-item`, op, {
        method: "POST",
        body: JSON.stringify({ barcode, rowVersion, clientOccurredAt: new Date().toISOString() }),
      });
    },
    scanLocation(sessionId: string, barcode: string, rowVersion: number, op: OperationRequestContext) {
      return request(`/api/v1/put-away/sessions/${encodeURIComponent(sessionId)}/scan-location`, op, {
        method: "POST",
        body: JSON.stringify({ barcode, rowVersion, clientOccurredAt: new Date().toISOString() }),
      });
    },
  },

  picking: {
    scanLocation(taskId: string, barcode: string, rowVersion: number, claimToken: string, op: OperationRequestContext) {
      return request(`/api/v1/picks/tasks/${encodeURIComponent(taskId)}/scan-location`, op, {
        method: "POST",
        headers: { "If-Match": String(rowVersion) },
        body: JSON.stringify({ barcode, claimToken }),
      });
    },
    scanItem(taskId: string, lineId: string, barcode: string, rowVersion: number, claimToken: string, op: OperationRequestContext) {
      return request(`/api/v1/picks/tasks/${encodeURIComponent(taskId)}/scan-item`, op, {
        method: "POST",
        headers: { "If-Match": String(rowVersion) },
        body: JSON.stringify({ barcode, claimToken, lineId }),
      });
    },
    scanDestination(taskId: string, barcode: string, rowVersion: number, claimToken: string, op: OperationRequestContext) {
      return request(`/api/v1/picks/tasks/${encodeURIComponent(taskId)}/scan-destination`, op, {
        method: "POST",
        headers: { "If-Match": String(rowVersion) },
        body: JSON.stringify({ barcode, claimToken }),
      });
    },
  },

  packShip: {
    scanSource(taskId: string, barcode: string, rowVersion: number, op: OperationRequestContext) {
      return request(`/api/v1/packing/tasks/${encodeURIComponent(taskId)}/scan-source`, op, {
        method: "POST",
        body: JSON.stringify({ barcode, rowVersion }),
      });
    },
    scanItem(taskId: string, barcode: string, rowVersion: number, op: OperationRequestContext) {
      return request(`/api/v1/packing/tasks/${encodeURIComponent(taskId)}/scan-item`, op, {
        method: "POST",
        body: JSON.stringify({ barcode, rowVersion }),
      });
    },
    verifyLabel(shipmentId: string, trackingBarcode: string, packageBarcode: string, op: OperationRequestContext) {
      return request(`/api/v1/shipments/${encodeURIComponent(shipmentId)}/label/verify`, op, {
        method: "POST",
        body: JSON.stringify({ trackingBarcode, packageBarcode }),
      });
    },
    stageOutbound(shipmentId: string, locationBarcode: string, op: OperationRequestContext) {
      return request(`/api/v1/shipments/${encodeURIComponent(shipmentId)}/outbound-stage`, op, {
        method: "POST",
        body: JSON.stringify({ locationBarcode }),
      });
    },
  },

  inventory: {
    resolveScan(value: string, op: OperationRequestContext) {
      return request("/api/v1/inventory/resolve-scan", op, {
        method: "POST",
        body: JSON.stringify({ value }),
      });
    },
  },

  returns: {
    resolveScan(value: string, op: OperationRequestContext) {
      return request("/api/v1/returns/resolve-scan", op, {
        method: "POST",
        body: JSON.stringify({ value }),
      });
    },
  },
};
