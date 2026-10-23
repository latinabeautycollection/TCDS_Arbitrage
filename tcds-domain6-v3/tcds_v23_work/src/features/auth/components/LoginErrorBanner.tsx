import { AlertTriangle, X } from 'lucide-react';
import { AuthApiError } from '../services/authApi';
import { employeeSafeAuthMessage } from '../policy/authErrorCatalog';

export function LoginErrorBanner({ error, onDismiss, title = 'Sign-in unsuccessful' }: { error: AuthApiError; onDismiss(): void; title?: string }) {
  return <div role="alert" aria-live="assertive" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-tcds-red">
    <div className="flex items-start gap-3">
      <AlertTriangle className="mt-0.5 shrink-0" size={19} />
      <div className="min-w-0 flex-1">
        <p className="font-black">{title}</p>
        <p className="mt-1 font-semibold">{employeeSafeAuthMessage(error)}</p>
        {error.retryAfterSeconds && <p className="mt-2 text-xs opacity-75">Try again in approximately {error.retryAfterSeconds} seconds.</p>}
        {error.requestId && <p className="mt-2 break-all text-xs opacity-75">Support reference: {error.requestId}</p>}
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss authentication error" className="tcds-focus rounded-lg p-1"><X size={18} /></button>
    </div>
  </div>;
}
