import { PackShipApiError } from "../services/packShipApi";
import type { PackShipTask } from "../types/packShipTypes";

export interface PendingPackShipRetry {
  readonly run: () => Promise<PackShipTask>;
  readonly successTitle: string;
  readonly successDetail?: string;
}

const UNCERTAIN_CODES = new Set(["REQUEST_TIMEOUT", "NETWORK_ERROR"]);

export function isUncertainPackShipError(error: unknown): boolean {
  if (!(error instanceof PackShipApiError)) return false;
  if (UNCERTAIN_CODES.has(error.code)) return true;
  return /^HTTP_5\d\d$/.test(error.code);
}
