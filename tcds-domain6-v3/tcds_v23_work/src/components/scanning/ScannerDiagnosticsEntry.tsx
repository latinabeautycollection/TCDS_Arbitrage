import {
  useCallback,
  useEffect,
  useRef,
  type PropsWithChildren,
} from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../features/auth/context/AuthContext";

/** Press and hold before the scanner diagnostic surface opens. */
export const SCANNER_DIAGNOSTICS_HOLD_MS = 1200;

export const SCANNER_DIAGNOSTICS_ROUTE =
  "/__diagnostics/scanner-capture";

/**
 * Hidden entry point to the scanner diagnostic surface.
 *
 * The surface has no navigation entry on purpose, and an installed PWA has no
 * address bar, so certification testing needs a way in that ordinary operators
 * do not meet. A deliberate press and hold opens it, and only for a signed-in
 * session; the route itself stays behind the same guard as every other screen.
 */
export function ScannerDiagnosticsEntry({
  children,
}: PropsWithChildren) {
  const navigate = useNavigate();
  const { session } = useAuth();

  const authenticated = Boolean(
    session?.authenticated,
  );

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
