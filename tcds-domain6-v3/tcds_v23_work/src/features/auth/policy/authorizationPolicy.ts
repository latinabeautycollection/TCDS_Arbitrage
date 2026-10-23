import type { BackendSessionContext } from '../types/authTypes';

export type WarehousePermission =
  | 'warehouse:dashboard:view'
  | 'warehouse:receive'
  | 'warehouse:photo'
  | 'warehouse:verify'
  | 'warehouse:putaway'
  | 'warehouse:inventory:read'
  | 'warehouse:pick'
  | 'warehouse:pack'
  | 'warehouse:return'
  | 'warehouse:settings:view'
  | 'warehouse:identity:passkey:enroll';

export function hasPermission(context: BackendSessionContext | null | undefined, permission?: string): boolean {
  if (!permission) return true;
  if (!context) return false;
  return context.permissions.includes(permission);
}

export function mayNavigate(context: BackendSessionContext | null | undefined, permission?: string): boolean {
  if (!context || context.restrictedSession) return false;
  return hasPermission(context, permission);
}
