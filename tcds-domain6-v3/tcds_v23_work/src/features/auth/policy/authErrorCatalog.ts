import type { AuthApiError } from '../services/authApi';

const catalog: Record<string, string> = {
  DEVICE_NOT_ENROLLED: 'This workstation has not completed secure device enrollment. Contact a warehouse administrator.',
  DEVICE_KEY_UNAVAILABLE: 'The approved device key is unavailable. Do not continue on this workstation.',
  DEVICE_PROOF_FAILED: 'This workstation could not prove its approved device identity.',
  AUTH_NETWORK_ERROR: 'The secure login service is unavailable. Check the network connection.',
  AUTH_TIMEOUT: 'The authentication service timed out. Try again.',
  PASSKEY_CANCELLED: 'Face ID or passkey verification was cancelled or could not be completed.',
  PASSKEY_ENROLLMENT_FAILED: 'Passkey enrollment could not be completed. Try again or contact a warehouse administrator.',
  PASSKEY_VERIFICATION_FAILED: 'The passkey could not be verified. Try again or use your password.',
  RESTRICTED_SESSION: 'Your password must be changed before warehouse operations can continue.',
  CSRF_REJECTED: 'The secure browser session could not be validated. Sign in again.',
  PERMISSION_DENIED: 'Your current warehouse role does not allow this action.',
  SESSION_INVALID: 'Your secure warehouse session is no longer valid. Sign in again.',
  AUTH_CANCELLED: 'The authentication request was cancelled.'
};

export function employeeSafeAuthMessage(error: AuthApiError): string {
  return catalog[error.code] ?? 'Unable to complete the secure authentication request. Verify your access or contact the warehouse administrator.';
}
