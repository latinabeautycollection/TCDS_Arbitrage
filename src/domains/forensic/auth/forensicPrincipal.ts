export interface ForensicPrincipal {
  tenantKey: string;
  actorType: 'user' | 'worker' | 'system' | 'api' | 'service_account';
  actorId: string;
  actorName?: string;
  warehouseUserId: string;
  warehouseEmployeeId: string;
  warehouseAuthSessionId: string;
  warehouseDeviceSessionId: string;
  facilityId: string;
  stationId?: string;
  deviceId: string;
  permissions: readonly string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      forensicPrincipal?: ForensicPrincipal;
      correlationId?: string;
    }
  }
}
