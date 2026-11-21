import { PackShipApiError } from "../services/packShipApi";
import type { PackShipTask } from "../types/packShipTypes";

export interface PendingPackShipRetry {
  readonly run: () => Promise<PackShipTask>;
  readonly successTitle: string;
  readonly successDetail?: string;
  /** Told how the action finally ended, also when it ends on a retry (e.g. so a scan field is cleared then). */
  readonly onSettled?: (outcome: PackShipActionOutcome) => void;
}

/** ok = applied; refused = the server answered no (or the answer was unusable); uncertain = kept for a retry. */
export type PackShipActionOutcome = "ok" | "refused" | "uncertain";

const UNCERTAIN_CODES = new Set(["REQUEST_TIMEOUT", "NETWORK_ERROR"]);

export function isUncertainPackShipError(error: unknown): boolean {
  if (!(error instanceof PackShipApiError)) return false;
  if (UNCERTAIN_CODES.has(error.code)) return true;
  return /^HTTP_5\d\d$/.test(error.code);
}
