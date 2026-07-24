import type {
  InventoryDetailResponse,
  InventoryFilter,
  InventoryListResponse,
  ManualAdmissionDraft,
  ScanResolution,
} from '../types/inventoryTypes';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '3.8.0';

export class InventoryApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

function requestHeaders(idempotencyKey?: string): HeadersInit {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Request-ID': crypto.randomUUID(),
    'X-Correlation-ID': crypto.randomUUID(),
    'X-TCDS-App-Version': APP_VERSION,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: { message?: string; code?: string } = {};
    try { body = await response.json() as typeof body; } catch { /* generic error */ }
    const retryAfter = Number(response.headers.get('Retry-After') ?? 0) || undefined;
    throw new InventoryApiError(body.message ?? 'Inventory service request failed.', response.status, body.code, retryAfter);
  }
  return response.json() as Promise<T>;
}

export async function getInventory(params: {
  query?: string;
  filter?: InventoryFilter;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<InventoryListResponse> {
  const search = new URLSearchParams();
  if (params.query) search.set('query', params.query);
  if (params.filter && params.filter !== 'ALL') search.set('filter', params.filter);
  if (params.cursor) search.set('cursor', params.cursor);
  const response = await fetch(`${API_BASE_URL}/api/v1/inventory?${search.toString()}`, {
    credentials: 'include',
    headers: requestHeaders(),
    cache: 'no-store',
    signal: params.signal,
  });
  return parseResponse<InventoryListResponse>(response);
}

export async function resolveInventoryScan(value: string): Promise<ScanResolution> {
  const response = await fetch(`${API_BASE_URL}/api/v1/inventory/resolve-scan`, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders(crypto.randomUUID()),
    body: JSON.stringify({ value }),
  });
  return parseResponse<ScanResolution>(response);
}

export async function getInventoryDetail(itemId: string, signal?: AbortSignal): Promise<InventoryDetailResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/inventory/items/${encodeURIComponent(itemId)}`, {
    credentials: 'include',
    headers: requestHeaders(),
    cache: 'no-store',
    signal,
  });
  return parseResponse<InventoryDetailResponse>(response);
}

export async function requestInventoryAction(
  itemId: string,
  actionCode: string,
  payload: Record<string, unknown>,
  expectedRowVersion: number,
): Promise<{ accepted: boolean; workflowRoute?: string; workflowToken?: string; message?: string }> {
  const response = await fetch(`${API_BASE_URL}/api/v1/inventory/items/${encodeURIComponent(itemId)}/actions`, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders(crypto.randomUUID()),
    body: JSON.stringify({ actionCode, payload, expectedRowVersion }),
  });
  return parseResponse(response);
}

export async function createManualAdmission(draft: ManualAdmissionDraft): Promise<{
  admissionId: string;
  itemId: string;
  internalBarcode: string;
  itemStatus: 'PROVISIONAL';
  barcodeStatus: 'ACTIVE_PENDING_VERIFICATION';
  holdCode: 'MANUAL_ADMISSION';
  remediationTasks: string[];
}> {
  const response = await fetch(`${API_BASE_URL}/api/v1/inventory/manual-admissions`, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders(crypto.randomUUID()),
    body: JSON.stringify(draft),
  });
  return parseResponse(response);
}
