import { z } from "zod";
import type { IntelligenceHubMode } from "../models/intelligenceContext";

const schema = z.object({
  mode: z.enum([
    "DISABLED", "OBSERVE_ONLY", "SHADOW", "RECOMMEND",
    "ENFORCE_NON_BLOCKING", "ENFORCE_BLOCKING"
  ]).default("SHADOW"),
  policyVersion: z.string().default("shipping-hub-policy-v1"),
  modelVersion: z.string().default("shipping-hub-model-v1"),
  rulesetVersion: z.string().default("shipping-hub-rules-v1"),
  minimumNetProfitUsd: z.coerce.number().nonnegative().default(50),
  minimumMarginPct: z.coerce.number().nonnegative().default(15),
  handlingCutoffEastern: z.string().default("14:00"),
  defaultHandlingBusinessDays: z.coerce.number().int().min(0).max(10).default(2),
  maxCarrierQuoteAgeMinutes: z.coerce.number().int().positive().default(30),
  maxZoneSnapshotAgeHours: z.coerce.number().int().positive().default(24),
  highValueThresholdUsd: z.coerce.number().nonnegative().default(250),
  ebaySignatureThresholdUsd: z.coerce.number().nonnegative().default(750)
});

export interface IntelligenceHubConfig {
  mode: IntelligenceHubMode;
  policyVersion: string;
  modelVersion: string;
  rulesetVersion: string;
  minimumNetProfitUsd: number;
  minimumMarginPct: number;
  handlingCutoffEastern: string;
  defaultHandlingBusinessDays: number;
  maxCarrierQuoteAgeMinutes: number;
  maxZoneSnapshotAgeHours: number;
  highValueThresholdUsd: number;
  ebaySignatureThresholdUsd: number;
}

export function loadIntelligenceHubConfig(
  env: NodeJS.ProcessEnv = process.env
): IntelligenceHubConfig {
  return schema.parse({
    mode: env.SHIPPING_INTELLIGENCE_MODE,
    policyVersion: env.SHIPPING_INTELLIGENCE_POLICY_VERSION,
    modelVersion: env.SHIPPING_INTELLIGENCE_MODEL_VERSION,
    rulesetVersion: env.SHIPPING_INTELLIGENCE_RULESET_VERSION,
    minimumNetProfitUsd: env.SHIPPING_MIN_NET_PROFIT_USD,
    minimumMarginPct: env.SHIPPING_MIN_MARGIN_PCT,
    handlingCutoffEastern: env.SHIPPING_HANDLING_CUTOFF_ET,
    defaultHandlingBusinessDays: env.SHIPPING_DEFAULT_HANDLING_DAYS,
    maxCarrierQuoteAgeMinutes: env.SHIPPING_MAX_QUOTE_AGE_MINUTES,
    maxZoneSnapshotAgeHours: env.SHIPPING_MAX_ZONE_SNAPSHOT_AGE_HOURS,
    highValueThresholdUsd: env.SHIPPING_HIGH_VALUE_THRESHOLD_USD,
    ebaySignatureThresholdUsd: env.SHIPPING_EBAY_SIGNATURE_THRESHOLD_USD
  }) as IntelligenceHubConfig;
}

export function modeCanBlock(mode: IntelligenceHubMode): boolean {
  return mode === "ENFORCE_BLOCKING";
}
