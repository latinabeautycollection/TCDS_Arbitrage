import type { AddressInput } from "../models/intelligenceContext";
import type { DestinationClass } from "../models/destinationIntelligence";

const CONTIGUOUS_EXCLUSIONS = new Set(["AK", "HI", "PR", "VI", "GU", "AS", "MP"]);

export function classifyDestination(address: AddressInput): DestinationClass {
  const country = address.countryCode.trim().toUpperCase();
  const state = address.stateOrProvince.trim().toUpperCase();

  if (country === "CA") return "CANADA";
  if (country !== "US") return "INTERNATIONAL_OTHER";
  if (/^(APO|FPO|DPO)$/i.test(address.city.trim())) return "APO_FPO_DPO";
  if (state === "AK") return "ALASKA";
  if (state === "HI") return "HAWAII";
  if (state === "PR") return "PUERTO_RICO";
  if (state === "VI") return "USVI";
  if (state === "GU") return "GUAM";
  if (!CONTIGUOUS_EXCLUSIONS.has(state)) return "CONTIGUOUS_US";
  return "UNKNOWN";
}
