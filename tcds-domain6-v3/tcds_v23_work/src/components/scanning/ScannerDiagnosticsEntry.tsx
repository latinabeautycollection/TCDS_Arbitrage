import {
  useCallback,
  useEffect,
  useRef,
  type PropsWithChildren,
} from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../features/auth/context/AuthContext";
import { isPreviewAccessEnabled } from "../../features/auth/routes/ProtectedRoute";

/** Press and hold before the scanner diagnostic surface opens. */
export const SCANNER_DIAGNOSTICS_HOLD_MS = 1200;

export const SCANNER_DIAGNOSTICS_ROUTE =
  "/__diagnostics/scanner-capture";

/**
 * Hidden entry point to the scanner diagnostic surface.
 *
 * The surface has no navigation entry on purpose, and an installed PWA has no
 * address bar, so certification testing needs a way in that ordinary operators
 * do not meet. A deliberate press and hold opens it.
 *
 * It follows exactly the same access rule as the route guard, and reads that rule
 * from the guard itself: a signed-in session, or the temporary preview access the
 * application already allows while the authentication shell is being built. This
 * adds no access path of its own, so when the temporary rule is withdrawn the
 * gesture closes with it and the route keeps its guard either way.
 */
export function ScannerDiagnosticsEntry({
  children,
}: PropsWithChildren) {
  const navigate = useNavigate();
  const { session } = useAuth();

  const authenticated =
    Boolean(session?.authenticated) ||
    isPreviewAccessEnabled();

  const holdTimer = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);

  const cancelHold = useCallback(() => {
    if (!holdTimer.current) return;
    clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);

  useEffect(
    () => cancelHold,
    [cancelHold],
  );

  const startHold = useCallback(() => {
    if (!authenticated) return;

    cancelHold();

    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      navigate(
        SCANNER_DIAGNOSTICS_ROUTE,
      );
    }, SCANNER_DIAGNOSTICS_HOLD_MS);
  }, [
    authenticated,
    cancelHold,
    navigate,
  ]);

  if (!authenticated) {
    return <>{children}</>;
  }

  return (
    <span
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onContextMenu={(event) =>
        event.preventDefault()
      }
      className="touch-none select-none"
      data-testid="scanner-diagnostics-entry"
    >
      {children}
    </span>
  );
}
