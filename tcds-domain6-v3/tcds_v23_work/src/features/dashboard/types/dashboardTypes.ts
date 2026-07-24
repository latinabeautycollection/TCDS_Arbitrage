export type HealthState = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
export interface DashboardQueue { key: 'RECEIVING'|'PICKING'|'SHIPPING'|'RETURNS'|'EXCEPTIONS'; label: string; count: number; blockedCount: number; highPriorityCount: number; description: string; updatedAt: string; route: string; actionLabel: string; }
export interface DashboardHealth { key: string; label: string; state: HealthState; detail: string; lastSeenAt?: string | null; }
export interface DashboardAlert { alertId: string; severity: 'INFO'|'WARNING'|'CRITICAL'; title: string; description: string; occurredAt: string; }
export interface DashboardMetric { key: string; label: string; value: string | number; detail?: string; }
export interface DashboardResponse { generatedAt: string; operator: { displayName: string; employeeNumber: string; role: string; }; facility: { facilityCode: string; facilityName: string; timezone: string; }; station: { stationCode: string; stationName: string; ready: boolean; }; queues: DashboardQueue[]; health: DashboardHealth[]; alerts: DashboardAlert[]; metrics: DashboardMetric[]; }
