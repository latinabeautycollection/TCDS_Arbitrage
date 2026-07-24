export type DeviceStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'RETIRED' | 'UNKNOWN';

export interface AuthBootstrap {
  environment: string;
  releaseVersion: string;
  serverTime: string;
  online: boolean;
  passwordEnabled: boolean;
  passkeyEnabled: boolean;
  webAuthnSupported: boolean;
  device: {
    deviceId: string | null;
    registered: boolean;
    trusted: boolean;
    status: DeviceStatus;
    facilityCode: string | null;
    stationCode: string | null;
  };
  readiness: {
    api: boolean;
    database: boolean;
    gateway: boolean | null;
    printer: boolean | null;
    scanner: boolean | null;
  };
}

export interface AuthenticatedUser {
  userId: string;
  employeeNumber: string;
  username: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  facilityId: string;
  facilityCode: string;
  stationId: string | null;
  stationCode: string | null;
  passkeyEnrolled: boolean;
}

export interface AuthSession {
  authenticated: boolean;
  user: AuthenticatedUser | null;
  expiresAt: string | null;
  idleExpiresAt: string | null;
  authenticationMethod: 'PASSWORD' | 'PASSKEY' | null;
}

export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface PasskeyAvailability {
  available: boolean;
}

export interface ApiProblem {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  detail?: string;
  requestId?: string;
  correlationId?: string;
  retryAfterSeconds?: number;
}
