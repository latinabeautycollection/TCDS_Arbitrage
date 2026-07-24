import type { SupervisorConsoleResponse, SupervisorMessage } from '../types/supervisorTypes';
import { supervisorMessage } from '../messages/supervisorMessageCatalog';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const APP_VERSION = '3.12.1';
function requestId() { return crypto.randomUUID(); }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const reqId = requestId();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': reqId,
      'X-Correlation-ID': reqId,
      'X-TCDS-App-Version': APP_VERSION,
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { code?: string; supportReference?: string };
    const mapped: SupervisorMessage = supervisorMessage(body.code ?? 'SUP_STALE_DATA', body.supportReference ?? reqId);
    throw mapped;
  }
  return response.json() as Promise<T>;
}

function mutation(path: string, body: unknown, expectedRowVersion?: number) {
  return api(path, {
    method: 'POST',
    headers: {
      'Idempotency-Key': crypto.randomUUID(),
      ...(expectedRowVersion !== undefined ? { 'If-Match': String(expectedRowVersion) } : {})
    },
    body: JSON.stringify(body)
  });
}

export const supervisorApi = {
  getConsole: () => api<SupervisorConsoleResponse>('/api/v1/supervisor/command-center'),
  getPackageLifecycle: (reference: string) => api(`/api/v1/supervisor/packages/${encodeURIComponent(reference)}/lifecycle`),
  acknowledgeException: (exceptionId: string, expectedRowVersion: number) => mutation(`/api/v1/supervisor/exceptions/${exceptionId}/acknowledge`, {}, expectedRowVersion),
  assignException: (exceptionId: string, assigneeUserId: string, expectedRowVersion: number) => mutation(`/api/v1/supervisor/exceptions/${exceptionId}/assign`, { assigneeUserId }, expectedRowVersion),
  containException: (exceptionId: string, containmentCode: string, notes: string, expectedRowVersion: number) => mutation(`/api/v1/supervisor/exceptions/${exceptionId}/contain`, { containmentCode, notes }, expectedRowVersion),
  resolveException: (exceptionId: string, resolutionCode: string, notes: string, expectedRowVersion: number) => mutation(`/api/v1/supervisor/exceptions/${exceptionId}/resolve`, { resolutionCode, notes }, expectedRowVersion),
  decideApproval: (approvalId: string, decision: 'APPROVE' | 'REJECT', reason: string, expectedRowVersion: number) => mutation(`/api/v1/supervisor/approvals/${approvalId}/decision`, { decision, reason }, expectedRowVersion),
  requestWorkflowAction: (insightId: string, action: 'ACCEPT' | 'DISMISS' | 'REVIEW', reason: string) => mutation(`/api/v1/supervisor/insights/${insightId}/decision`, { action, reason }),
  reassignEmployee: (employeeId: string, workflow: string, reason: string, expectedRowVersion: number) => mutation(`/api/v1/supervisor/workforce/${employeeId}/reassign`, { workflow, reason }, expectedRowVersion),
  createShiftHandoff: (notes: string, expectedRowVersion: number) => mutation('/api/v1/supervisor/shift-handoffs', { notes }, expectedRowVersion),
  acknowledgeShiftHandoff: (handoffId: string, expectedRowVersion: number) => mutation(`/api/v1/supervisor/shift-handoffs/${handoffId}/acknowledge`, {}, expectedRowVersion),
  retrySync: (operationId: string) => mutation(`/api/v1/supervisor/sync/${operationId}/retry`, {}),
  replayDeadLetter: (operationId: string, reason: string) => mutation(`/api/v1/supervisor/sync/${operationId}/replay`, { reason }),
  requestDeviceCheck: (deviceId: string) => mutation(`/api/v1/supervisor/devices/${deviceId}/health-check`, {}),
  quarantineDevice: (deviceId: string, reason: string) => mutation(`/api/v1/supervisor/devices/${deviceId}/quarantine`, { reason })
};
