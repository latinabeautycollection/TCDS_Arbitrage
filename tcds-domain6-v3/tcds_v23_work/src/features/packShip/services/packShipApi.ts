import type { PackagingOptions, PackShipTask } from '../types/packShipTypes';
import type { PackShipMessage } from '../types/packShipMessages';
import type { PackShipLabelPairEvidence } from '../scanning/packShipLabelEvidence';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const APP_VERSION = import.meta.env.VITE_APP_VERSION || '3.10.1';

function uuid(): string { return crypto.randomUUID(); }
// Login V2 refuses a write without the session's CSRF token, which it keeps in a readable
// cookie; the request echoes it the same way the recovery client does.
function csrfHeader(): Record<string, string> {
  const value = document.cookie.split('; ').find((v) => v.startsWith('__Host-tcds_csrf='))?.split('=').slice(1).join('=');
  return value ? { 'X-CSRF-Token': decodeURIComponent(value) } : {};
}
function installationId(): string {
  const key = 'tcds.installation_id';
  const current = localStorage.getItem(key);
  if (current) return current;
  const created = uuid(); localStorage.setItem(key, created); return created;
}

/** Capture observation metadata is evidence only; backend still authorizes every operation. */
export type PackShipCaptureEvidence = {
  source: 'CAMERA' | 'MANUAL' | 'HID';
  observationId?: string;
  capturedAt?: string;
  provider?: string;
  symbology?: string;
  canonicalSymbology?: string;
};

/** Package measurements in the units the Pack/Ship routes take: ounces and inches. */
export type PackShipMeasurementInput = {
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

/** Where the weight came from: a stable scale reading, or manual entry a supervisor approved. */
export type PackShipWeightSource =
  | { type: 'SCALE'; weighSessionId: string }
  | { type: 'MANUAL'; overrideDecisionId: string };

export type OperationContext = {
  clientOperationId: string;
  correlationId: string;
};

export class PackShipApiError extends Error {
  code: string;
  supportReference?: string;
  retryAfterSeconds?: number;
  messageOverride?: Partial<PackShipMessage>;
  /** The X-Request-ID of the attempt that failed, so a refusal can be traced in the server logs. */
  requestId?: string;
  constructor(code: string, supportReference?: string, retryAfterSeconds?: number, messageOverride?: Partial<PackShipMessage>, requestId?: string) {
    super(code); this.name = 'PackShipApiError'; this.code = code; this.supportReference = supportReference; this.retryAfterSeconds = retryAfterSeconds; this.messageOverride = messageOverride; this.requestId = requestId;
  }
}

async function request<T>(path: string, init: RequestInit = {}, idempotencyKey?: string, correlationId?: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  const requestId = uuid();
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', 'X-Request-ID': requestId, 'X-Correlation-ID': correlationId ?? uuid(),
        'X-TCDS-App-Version': APP_VERSION, 'X-TCDS-Installation-ID': installationId(), ...csrfHeader(),
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
      }, requestId);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof PackShipApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw new PackShipApiError('REQUEST_TIMEOUT', undefined, undefined, undefined, requestId);
    throw new PackShipApiError('NETWORK_ERROR', undefined, undefined, undefined, requestId);
  } finally { window.clearTimeout(timeout); }
}

// Calls given an OperationContext send its ids on every attempt, so a retry is recognised
// as the same operation; without one, each call gets new ids.
export const packShipApi = {
  getTask: (taskId: string) => request<PackShipTask>(`/api/v1/packing/tasks/${encodeURIComponent(taskId)}`),
  getPackagingOptions: (taskId: string) => request<PackagingOptions>(`/api/v1/packing/tasks/${encodeURIComponent(taskId)}/packaging-options`),
  claim: (taskId: string, operation?: OperationContext) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/claim`, { method: 'POST', body: '{}' }, operation?.clientOperationId ?? uuid(), operation?.correlationId),
  scanSource: (taskId: string, barcode: string, rowVersion: number, operation?: OperationContext, capture?: PackShipCaptureEvidence) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/scan-source`, { method: 'POST', body: JSON.stringify({ barcode, rowVersion, ...(capture ? { capture } : {}) }) }, operation?.clientOperationId ?? uuid(), operation?.correlationId),
  scanItem: (taskId: string, barcode: string, rowVersion: number, operation?: OperationContext, capture?: PackShipCaptureEvidence) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/scan-item`, { method: 'POST', body: JSON.stringify({ barcode, rowVersion, ...(capture ? { capture } : {}) }) }, operation?.clientOperationId ?? uuid(), operation?.correlationId),
  selectPackage: (taskId: string, profileId: string, reason: string | undefined, rowVersion: number, operation?: OperationContext) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/package`, { method: 'POST', body: JSON.stringify({ profileId, reason, rowVersion }) }, operation?.clientOperationId ?? uuid(), operation?.correlationId),
  saveMeasurements: (taskId: string, rowVersion: number, packageId: string, packageRowVersion: number, measurement: PackShipMeasurementInput, weightSource: PackShipWeightSource, operation?: OperationContext) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/measurements`, { method: 'POST', body: JSON.stringify({ rowVersion, packageId, packageRowVersion, weightOz: measurement.weightOz, lengthIn: measurement.lengthIn, widthIn: measurement.widthIn, heightIn: measurement.heightIn, weightSource }) }, operation?.clientOperationId ?? uuid(), operation?.correlationId),
  seal: (taskId: string, rowVersion: number, packageId: string, packageRowVersion: number, operation?: OperationContext) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/seal`, { method: 'POST', body: JSON.stringify({ rowVersion, packageId, packageRowVersion }) }, operation?.clientOperationId ?? uuid(), operation?.correlationId),
  validateAddress: (shipmentId: string) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/address/validate`, { method: 'POST', body: '{}' }, uuid()),
  getRates: (shipmentId: string) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/rates`, { method: 'POST', body: '{}' }, uuid()),
  evaluateRisk: (shipmentId: string) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/risk/evaluate`, { method: 'POST', body: '{}' }, uuid()),
  selectRate: (shipmentId: string, quoteId: string, reason?: string) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/rates/select`, { method: 'POST', body: JSON.stringify({ quoteId, reason }) }, uuid()),
  purchaseLabel: (shipmentId: string, operation?: OperationContext) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/label/purchase`, { method: 'POST', body: '{}' }, operation?.clientOperationId ?? uuid(), operation?.correlationId),
  printLabel: (shipmentId: string, operation?: OperationContext) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/label/print`, { method: 'POST', body: '{}' }, operation?.clientOperationId ?? uuid(), operation?.correlationId),
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
  stageOutbound: (shipmentId: string, locationBarcode: string, operation?: OperationContext, capture?: PackShipCaptureEvidence) => request<PackShipTask>(`/api/v1/shipments/${shipmentId}/outbound-stage`, { method: 'POST', body: JSON.stringify({ locationBarcode, ...(capture ? { capture } : {}) }) }, operation?.clientOperationId ?? uuid(), operation?.correlationId),
  completionCheck: (taskId: string) => request<PackShipTask>(`/api/v1/packing/tasks/${taskId}/completion-check`, { method: 'POST', body: '{}' }, uuid()),
};
