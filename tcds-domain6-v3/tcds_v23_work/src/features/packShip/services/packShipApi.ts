import type { PackShipTask } from '../types/packShipTypes';
import type { PackShipMessage } from '../types/packShipMessages';
import type { PackShipLabelPairEvidence } from '../scanning/packShipLabelEvidence';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const APP_VERSION = import.meta.env.VITE_APP_VERSION || '3.10.1';

function uuid(): string { return crypto.randomUUID(); }
function installationId(): string {
  const key = 'tcds.installation_id';
  const current = localStorage.getItem(key);
  if (current) return current;
  const created = uuid(); localStorage.setItem(key, created); return created;
}

export type OperationContext = {
  clientOperationId: string;
  correlationId: string;
};

export class PackShipApiError extends Error {
  code: string;
  supportReference?: string;
  retryAfterSeconds?: number;
  messageOverride?: Partial<PackShipMessage>;
  constructor(code: string, supportReference?: string, retryAfterSeconds?: number, messageOverride?: Partial<PackShipMessage>) {
    super(code); this.name = 'PackShipApiError'; this.code = code; this.supportReference = supportReference; this.retryAfterSeconds = retryAfterSeconds; this.messageOverride = messageOverride;
  }
}

async function request<T>(path: string, init: RequestInit = {}, idempotencyKey?: string, correlationId?: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', 'X-Request-ID': uuid(), 'X-Correlation-ID': correlationId ?? uuid(),
        'X-TCDS-App-Version': APP_VERSION, 'X-TCDS-Installation-ID': installationId(),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}), ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = response.status === 401 ? 'SESSION_EXPIRED' : (body?.code || `HTTP_${response.status}`);
      throw new PackShipApiError(code, body?.supportReference || response.headers.get('X-Support-Reference') || undefined, body?.retryAfterSeconds, {
        title: body?.employeeTitle, explanation: body?.employeeExplanation, nextAction: body?.nextAction,
        primaryActionLabel: body?.primaryActionLabel, secondaryActionLabel: body?.secondaryActionLabel,
        blocking: body?.blocking, retryable: body?.retryable, severity: body?.severity, presentation: body?.presentation,
      });
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof PackShipApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw new PackShipApiError('REQUEST_TIMEOUT');
    throw new PackShipApiError('NETWORK_ERROR');
  } finally { window.clearTimeout(timeout); }
}

export const packShipApi = {
  getTask: (taskId: string) => request<PackShipTask>(`/api/v1/packing/tasks/${encodeURIComponent(taskId)}`),
  claim: (taskId: string) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/claim`, { method: 'POST', body: '{}' }, uuid()),
  scanSource: (taskId: string, barcode: string, rowVersion: number, operation?: OperationContext) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/scan-source`, { method: 'POST', body: JSON.stringify({ barcode, rowVersion }) }, operation?.clientOperationId ?? uuid(), operation?.correlationId),
  scanItem: (taskId: string, barcode: string, rowVersion: number, operation?: OperationContext) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/scan-item`, { method: 'POST', body: JSON.stringify({ barcode, rowVersion }) }, operation?.clientOperationId ?? uuid(), operation?.correlationId),
  selectPackage: (taskId: string, profileId: string, reason: string | undefined, rowVersion: number) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/package`, { method: 'POST', body: JSON.stringify({ profileId, reason, rowVersion }) }, uuid()),
  saveMeasurements: (taskId: string, payload: unknown, rowVersion: number) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/measurements`, { method: 'POST', body: JSON.stringify({ ...(payload as object), rowVersion }) }, uuid()),
  seal: (taskId: string, rowVersion: number) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/seal`, { method: 'POST', body: JSON.stringify({ rowVersion }) }, uuid()),
  validateAddress: (shipmentId: string) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/address/validate`, { method: 'POST', body: '{}' }, uuid()),
  getRates: (shipmentId: string) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/rates`, { method: 'POST', body: '{}' }, uuid()),
  evaluateRisk: (shipmentId: string) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/risk/evaluate`, { method: 'POST', body: '{}' }, uuid()),
  selectRate: (shipmentId: string, quoteId: string, reason?: string) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/rates/select`, { method: 'POST', body: JSON.stringify({ quoteId, reason }) }, uuid()),
  purchaseLabel: (shipmentId: string) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/label/purchase`, { method: 'POST', body: '{}' }, uuid()),
  printLabel: (shipmentId: string) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/label/print`, { method: 'POST', body: '{}' }, uuid()),
  verifyLabel: (
    shipmentId: string,
    trackingBarcode: string,
    packageBarcode: string,
    operation?: OperationContext,
    evidence?: PackShipLabelPairEvidence,
  ) => request<PackShipTask>(
    `/api/v1/shipments/${shipmentId}/label/verify`,
    {
      method: 'POST',
      body: JSON.stringify({
        trackingBarcode,
        packageBarcode,
        ...(evidence ? { physicalEvidence: evidence } : {}),
      }),
    },
    operation?.clientOperationId ?? uuid(),
    operation?.correlationId,
  ),
  stageOutbound: (shipmentId: string, locationBarcode: string, operation?: OperationContext) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/outbound-stage`, { method: 'POST', body: JSON.stringify({ locationBarcode }) }, operation?.clientOperationId ?? uuid(), operation?.correlationId),
  completionCheck: (taskId: string) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/completion-check`, { method: 'POST', body: '{}' }, uuid()),
};
