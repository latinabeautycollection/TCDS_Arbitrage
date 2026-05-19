import crypto from "crypto";

export function makeRequestId(prefix = "req"): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
