export type ForensicActorType =
  | 'user'
  | 'worker'
  | 'system'
  | 'api'
  | 'service_account';

export interface ForensicWarehouseContext {
  readonly warehouseUserId: string;
  readonly warehouseEmployeeId: string;
  readonly warehouseAuthSessionId: string;
  readonly warehouseDeviceSessionId: string;
  readonly facilityId: string;
  readonly stationId?: string;
  readonly deviceId: string;
}

export interface AuthenticatedForensicPrincipal {
  readonly tenantKey: string;
  readonly actorType: ForensicActorType;
  readonly actorId: string;
  readonly actorName?: string;
  readonly permissions: ReadonlySet<string>;
  readonly warehouse?: ForensicWarehouseContext;
}

/** Compatibility alias retained for installed 7B imports. */
export type ForensicPrincipal = AuthenticatedForensicPrincipal;

export function requireWarehousePrincipalContext(
  principal: AuthenticatedForensicPrincipal,
): ForensicWarehouseContext {
  if (!principal.warehouse) {
    const error = new Error('Warehouse forensic context is required.');
    Object.assign(error, {
      status: 403,
      code: 'WAREHOUSE_FORENSIC_CONTEXT_REQUIRED',
    });
    throw error;
  }
  return principal.warehouse;
}
