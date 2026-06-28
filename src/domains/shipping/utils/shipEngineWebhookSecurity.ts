import crypto from "crypto";

export interface ShipEngineWebhookSecurityInput {
  bodyText: string;
  secret?: string;
  receivedSecret?: string;
  timestamp?: string;
  signature?: string;
  requireSecret: boolean;
  requireTimestamp: boolean;
  maxSkewSeconds: number;
}

export interface ShipEngineWebhookSecurityResult {
  secretHeaderPresent: boolean;
  timestampValid: boolean;
  signatureValid: boolean;
  rejected: boolean;
  rejectionReason?: string;
  payloadHash: string;
}

export function validateShipEngineWebhookSecurity(input: ShipEngineWebhookSecurityInput): ShipEngineWebhookSecurityResult {
  const payloadHash = crypto.createHash("sha256").update(input.bodyText || "").digest("hex");
  const secretHeaderPresent = Boolean(input.receivedSecret);
  const timestampValid = validateTimestamp(input.timestamp, input.maxSkewSeconds);
  const signatureValid = validateSignature(input.bodyText, input.timestamp, input.secret, input.signature);

  if (input.requireSecret && input.receivedSecret !== input.secret) {
    return { secretHeaderPresent, timestampValid, signatureValid, rejected: true, rejectionReason: "INVALID_SECRET", payloadHash };
  }

  if (input.requireTimestamp && !timestampValid) {
    return { secretHeaderPresent, timestampValid, signatureValid, rejected: true, rejectionReason: "INVALID_TIMESTAMP", payloadHash };
  }

  if (input.signature && !signatureValid) {
    return { secretHeaderPresent, timestampValid, signatureValid, rejected: true, rejectionReason: "INVALID_SIGNATURE", payloadHash };
  }

  return { secretHeaderPresent, timestampValid, signatureValid, rejected: false, payloadHash };
}

function validateTimestamp(timestamp: string | undefined, maxSkewSeconds: number): boolean {
  if (!timestamp) return false;
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return false;
  return Math.abs(Date.now() - ms) <= maxSkewSeconds * 1000;
}

function validateSignature(bodyText: string, timestamp: string | undefined, secret: string | undefined, signature: string | undefined): boolean {
  if (!signature) return true;
  if (!secret || !timestamp) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${bodyText}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
