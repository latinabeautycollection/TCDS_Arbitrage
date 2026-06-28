import crypto from "crypto";

export function hashJson(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? {})).digest("hex");
}

export function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function classifyShipEngineError(httpStatus?: number): "TRANSIENT" | "HARD" | "UNKNOWN" {
  if (!httpStatus) return "UNKNOWN";
  if ([429, 500, 502, 503, 504].includes(httpStatus)) return "TRANSIENT";
  return "HARD";
}

export function verifyShipEngineWebhookSecret(headerSecret: string | undefined, expectedSecret?: string, required = true): boolean {
  if (!required) return true;
  if (!expectedSecret) return false;
  return headerSecret === expectedSecret;
}

export function normalizeMoney(value: any): { amount?: number; currency?: string } {
  if (!value) return {};
  return { amount: Number(value.amount ?? 0), currency: value.currency };
}

export function trackingExceptionCode(statusCode?: string, detailCode?: string, exception?: string): string {
  const sc = (statusCode ?? "").toUpperCase();
  const dc = (detailCode ?? "").toUpperCase();
  if (dc === "DELIVERED" || sc === "DE") return "DELIVERED";
  if (exception) return "EXCEPTION";
  if (["IT", "IN_TRANSIT"].includes(sc)) return "IN_TRANSIT";
  if (["AC", "ACCEPTED"].includes(sc)) return "ACCEPTED";
  return "NORMAL";
}
