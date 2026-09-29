/**
 * Whether the application is running as an installed web app rather than in a
 * browser tab.
 *
 * The distinction matters for the camera: an installed web app does not keep its
 * camera grant across a background, while a browser tab does. Reported by the
 * platform, never configured.
 */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const navigatorWithStandalone =
    window.navigator as Navigator & {
      standalone?: boolean;
    };

  // iOS reports the Home Screen web app here.
  if (
    navigatorWithStandalone?.standalone ===
    true
  ) {
    return true;
  }

  try {
    return (
      window.matchMedia?.(
        "(display-mode: standalone)",
      )?.matches === true
    );
  } catch {
    // A platform that cannot answer is treated as a browser tab.
    return false;
  }
}
