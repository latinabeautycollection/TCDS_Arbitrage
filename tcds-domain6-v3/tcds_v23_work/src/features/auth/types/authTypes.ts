export type AuthState = 'bootstrapping' | 'anonymous' | 'device-proof' | 'authenticating' | 'authenticated' | 'restricted' | 'unavailable';
export type AssuranceLevel = 'AAL1' | 'AAL2';
export type AuthenticationMethod = 'PASSWORD' | 'PASSKEY' | 'BREAK_GLASS';
export type DeviceAlgorithm = 'Ed25519' | 'ES256';

export interface DeviceEnrollmentProfile {
  schemaVersion: 1;
  deviceId: string;
  facilityId: string;
  stationId: string | null;
  credentialId: string;
  algorithm: DeviceAlgorithm;
  deviceCode?: string;
  facilityCode?: string;
  stationCode?: string;
  enrolledAt: string;
}

export interface DeviceSecrets {
  schemaVersion: 1;
  deviceAssertion: string;
  signingKey: CryptoKey;
}

export interface BackendSessionContext {
  authSessionId: string;
  userId: string;
  employeeId: string;
  employeeNumber: string;
  deviceId: string;
  facilityId: string;
  stationId: string | null;
  assuranceLevel: AssuranceLevel;
  authenticationMethod: AuthenticationMethod;
  permissions: string[];
  restrictedSession: boolean;
  breakGlass: boolean;
}

export interface BackendSessionEnvelope {
  session: BackendSessionContext;
  absoluteExpiresAt?: string;
  idleExpiresAt?: string;
}

export interface AuthSession {
  authenticated: boolean;
  context: BackendSessionContext | null;
  expiresAt: string | null;
  idleExpiresAt: string | null;
}

export interface UiBootstrap {
  environment: string;
  releaseVersion: string;
  serverReady: boolean;
  redisReady: boolean | null;
  databaseReady: boolean | null;
  webAuthnSupported: boolean;
  platformAuthenticatorAvailable: boolean;
  deviceEnrolled: boolean;
  deviceProfile: DeviceEnrollmentProfile | null;
}

export interface LoginRequest { identifier: string; password: string }
export interface DeviceProofOptions { challengeId: string; rawNonce: string; expiresInSeconds: number }
export interface DeviceProofVerifyRequest { deviceId: string; challengeId: string; rawNonce: string; signatureBase64url: string }
export interface VerifierResultV1 {
  contractVersion: '1.0'; verified: true; ceremony: 'DEVICE_PROOF' | 'PASSKEY_REGISTRATION' | 'PASSKEY_AUTHENTICATION'; outcome: 'SUCCEEDED';
  userId: string; deviceId: string | null; passkeyId: string | null; challengeId: string; evidenceId: string; assuranceLevel: 'AAL2';
  requestId: string; correlationId: string; issuedAt: string; expiresAt: string; verifierService: string; verifierInstance: string; resultNonce: string; signature: string;
}

export interface AuthenticationOptionsEnvelope { challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }
export interface RegistrationOptionsEnvelope { challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }

export interface PublicKeyCredentialDescriptorJSON { id: string; type: PublicKeyCredentialType; transports?: AuthenticatorTransport[] }
export interface PublicKeyCredentialRequestOptionsJSON { challenge: string; timeout?: number; rpId?: string; allowCredentials?: PublicKeyCredentialDescriptorJSON[]; userVerification?: UserVerificationRequirement; extensions?: AuthenticationExtensionsClientInputs }
export interface PublicKeyCredentialCreationOptionsJSON {
  challenge: string; rp: PublicKeyCredentialRpEntity; user: Omit<PublicKeyCredentialUserEntity,'id'> & {id:string}; pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number; excludeCredentials?: PublicKeyCredentialDescriptorJSON[]; authenticatorSelection?: AuthenticatorSelectionCriteria; attestation?: AttestationConveyancePreference; extensions?: AuthenticationExtensionsClientInputs;
}

export interface AuthenticationResponseJSON { id:string; rawId:string; type:PublicKeyCredentialType; response:{authenticatorData:string;clientDataJSON:string;signature:string;userHandle:string|null}; clientExtensionResults:AuthenticationExtensionsClientOutputs; authenticatorAttachment:AuthenticatorAttachment|null }
export interface RegistrationResponseJSON { id:string; rawId:string; type:PublicKeyCredentialType; response:{attestationObject:string;clientDataJSON:string;transports?:AuthenticatorTransport[];publicKeyAlgorithm?:number;publicKey?:string|null}; clientExtensionResults:AuthenticationExtensionsClientOutputs; authenticatorAttachment:AuthenticatorAttachment|null }

export interface ApiErrorPayload { error?: {code?:string;message?:string;requestId?:string;retryAfterSeconds?:number}; code?:string; message?:string; requestId?:string; retryAfterSeconds?:number }
