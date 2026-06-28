import crypto from "crypto";

export function hashJson(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? {})).digest("hex");
}

export function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function classifyDhlError(httpStatus?: number): "TRANSIENT" | "HARD" | "UNKNOWN" {
  if (!httpStatus) return "UNKNOWN";
  if ([429, 500, 502, 503, 504].includes(httpStatus)) return "TRANSIENT";
  return "HARD";
}

export function detectDhlTrackingRisk(statusCode?: string, status?: string): string {
  const code = (statusCode ?? "").toLowerCase();
  const text = (status ?? "").toUpperCase();
  if (code.includes("delivered") || text.includes("DELIVERED")) return "DELIVERED";
  if (code.includes("failure") || text.includes("FAILED")) return "FAILED";
  if (text.includes("CUSTOMS")) return "CUSTOMS";
  if (text.includes("RETURN")) return "RETURN";
  if (text.includes("DELAY")) return "DELAYED";
  if (code.includes("pre-transit")) return "PRE_TRANSIT";
  if (code.includes("transit")) return "IN_TRANSIT";
  return "NORMAL";
}

export function basicAuthMatches(authHeader: string | undefined, username?: string, password?: string): boolean {
  if (!username || !password) return false;
  if (!authHeader?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString("utf8");
  return decoded === `${username}:${password}`;
}
