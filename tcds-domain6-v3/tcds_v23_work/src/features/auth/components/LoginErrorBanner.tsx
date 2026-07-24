import { AlertTriangle, X } from 'lucide-react';
import { AuthApiError } from '../services/authApi';

function friendlyMessage(error: AuthApiError): string {
  switch (error.code) {
    case 'ACCOUNT_LOCKED': return 'This account is temporarily unavailable. Contact the warehouse administrator.';
    case 'DEVICE_NOT_REGISTERED': return 'This device is not registered for warehouse access.';
    case 'DEVICE_SUSPENDED': return 'This device is unavailable for warehouse access. Contact the warehouse administrator.';
    case 'STATION_NOT_AUTHORIZED': return 'This sign-in cannot be completed at the assigned warehouse station.';
    case 'AUTH_TIMEOUT': return 'The secure login service timed out. Try again.';
    case 'AUTH_NETWORK_ERROR': return 'The secure login service is unavailable. Check the network connection.';
    case 'PASSKEY_CANCELLED': return 'Face ID or passkey verification was cancelled or could not be completed.';
    default: return 'Unable to sign in. Verify your credentials or contact the warehouse administrator.';
  }
}

export function LoginErrorBanner({ error, onDismiss }: { error: AuthApiError; onDismiss(): void }) {
  return (
    <div role="alert" aria-live="assertive" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-tcds-red">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 shrink-0" size={19} />
        <div className="min-w-0 flex-1">
          <p className="font-black">Sign-in unsuccessful</p>
          <p className="mt-1 font-semibold">{friendlyMessage(error)}</p>
          {error.retryAfterSeconds && <p className="mt-2 text-xs opacity-75">Try again in approximately {error.retryAfterSeconds} seconds.</p>}
          {error.requestId && <p className="mt-2 break-all text-xs opacity-75">Support reference: {error.requestId}</p>}
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss sign-in error" className="tcds-focus rounded-lg p-1"><X size={18} /></button>
      </div>
    </div>
  );
}
