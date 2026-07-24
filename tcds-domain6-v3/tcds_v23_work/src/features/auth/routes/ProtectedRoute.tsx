import { Navigate, useLocation } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { useAuth } from '../context/AuthContext';

// PREVIEW TOGGLE (temporary): when VITE_PREVIEW_UNLOCK=true, the auth gate is bypassed so the
// warehouse manager can view every screen before the backend auth API exists. Set it to false
// (or unset) to restore real authentication. Remove this block once the backend is live.
const PREVIEW_UNLOCK = import.meta.env.VITE_PREVIEW_UNLOCK === 'true';

export function ProtectedRoute({ children }: PropsWithChildren) {
  const { state, session } = useAuth();
  const location = useLocation();

  if (PREVIEW_UNLOCK) {
    return <>{children}</>;
  }

  if (state === 'bootstrapping') {
    return <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite"><div className="skeleton h-14 w-56 rounded-2xl" /></div>;
  }

  if (!session?.authenticated) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
