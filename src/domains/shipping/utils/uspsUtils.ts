import crypto from "crypto";
import { USPS_EXTRA_SERVICES, uspsInsuranceExtraServiceForValue } from "../constants/uspsConstants";
export function hashJson(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? {})).digest("hex");
}
export function normalizeUspsPrice(option: Record<string, unknown>): number | undefined {
  for (const key of ["totalPrice", "totalBasePrice", "price", "totalPostage", "postage"]) {
    const value = option[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  }
  return undefined;
}
export function buildUspsProtectionExtraServices(args: { itemValue?: number; requireInsurance?: boolean; requireSignature?: boolean; requireRestrictedDelivery?: boolean; }): number[] {
  const services = new Set<number>();
  if (args.requireInsurance) {
    const insurance = uspsInsuranceExtraServiceForValue(args.itemValue ?? 0);
    if (insurance) services.add(insurance);
  }
  if (args.requireSignature) services.add(USPS_EXTRA_SERVICES.SIGNATURE_CONFIRMATION);
  if (args.requireRestrictedDelivery) services.add(USPS_EXTRA_SERVICES.INSURANCE_RESTRICTED_DELIVERY);
  if (services.size === 0) services.add(USPS_EXTRA_SERVICES.TRACKING);
  return [...services];
}
export function detectUspsTrackingRisk(item: { status?: string; statusCategory?: string; statusSummary?: string }): string {
  const text = `${item.status ?? ""} ${item.statusCategory ?? ""} ${item.statusSummary ?? ""}`.toUpperCase();
  if (text.includes("DELIVERED")) return "DELIVERED";
  if (text.includes("NOTICE LEFT")) return "NOTICE_LEFT";
  if (text.includes("AVAILABLE FOR PICKUP")) return "PICKUP_REQUIRED";
  if (text.includes("RETURN")) return "RETURN";
  if (text.includes("FORWARDED")) return "FORWARDED";
  if (text.includes("EXCEPTION") || text.includes("ALERT")) return "EXCEPTION";
  if (text.includes("DELAY")) return "DELAYED";
  return "NORMAL";
}
