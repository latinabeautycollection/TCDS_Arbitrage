import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../policy/authorizationPolicy';

export function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { state, session } = useAuth();
  const location = useLocation();

  if (state === 'bootstrapping') {
    return <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite"><div className="skeleton h-14 w-56 rounded-2xl" /></div>;
  }

  if (!session.authenticated) return <Navigate to="/" replace state={{ from: location.pathname }} />;
  if (session.context?.restrictedSession && location.pathname !== '/auth/restricted') return <Navigate to="/auth/restricted" replace />;
  if (permission && !hasPermission(session.context, permission)) return <Navigate to="/dashboard" replace state={{ deniedPermission: permission }} />;

  return <>{children}</>;
}

/** Compatibility export required by the existing Scandit diagnostics route. Production is always fail-closed. */
export function isPreviewAccessEnabled(): boolean {
  return Boolean(import.meta.env.DEV && import.meta.env.VITE_ENABLE_AUTH_PREVIEW === 'true');
}
