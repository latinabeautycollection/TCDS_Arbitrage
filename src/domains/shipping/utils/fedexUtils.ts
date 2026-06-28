import crypto from "crypto";

export function hashJson(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? {})).digest("hex");
}

export function hashSecret(value?: string): string | null {
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeFedExMoney(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return undefined;
}

export function extractFedExRateAmount(detail: any): number | undefined {
  return normalizeFedExMoney(
    detail?.ratedShipmentDetails?.[0]?.totalNetCharge ??
    detail?.ratedShipmentDetails?.[0]?.shipmentRateDetail?.totalNetCharge ??
    detail?.totalNetCharge
  );
}

export function dimWeightLb(lengthIn: number, widthIn: number, heightIn: number, divisor = 139): number {
  return Math.ceil((lengthIn * widthIn * heightIn) / divisor);
}

export function fedexTrackingRisk(item: any): string {
  const text = `${item?.latestStatusDetail?.code ?? ""} ${item?.latestStatusDetail?.description ?? ""}`.toUpperCase();
  if (text.includes("DELIVERED") || text.includes("DL")) return "DELIVERED";
  if (text.includes("EXCEPTION") || text.includes("DELAY") || text.includes("CLEARANCE")) return "EXCEPTION";
  if (text.includes("RETURN")) return "RETURN";
  return "NORMAL";
}
