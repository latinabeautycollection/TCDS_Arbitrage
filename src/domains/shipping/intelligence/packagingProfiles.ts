/**
 * TCDS Domain 3 — Packaging Profiles Green Tier 1 V2
 *
 * Estimates safe package profile, billable weight, packaging cost, labor cost,
 * surcharge risk, insurance/signature/security flags, and learning deltas during
 * PropertyRoom ingestion before warehouse measurements exist.
 *
 * Existing V1 profiles are preserved and expanded.
 */

export type PackagingProfileKey =
  | "iphone"
  | "smartphone"
  | "earbuds"
  | "tablet"
  | "laptop"
  | "desktopMiniPc"
  | "gameConsole"
  | "handheldConsole"
  | "graphicsCard"
  | "camera"
  | "cameraLens"
  | "networkDevice"
  | "smallElectronics"
  | "mediumElectronics"
  | "largeElectronics"
  | "automotiveHandTool"
  | "automotivePowerTool"
  | "gardenHandTool"
  | "gardenPowerTool"
  | "longGardenTool"
  | "otherWeightOnlySmall"
  | "otherWeightOnlyMedium"
  | "otherWeightOnlyLarge"
  | "otherWeightOnlyOversize"
  | "watch"
  | "jewelrySmall"
  | "jewelryLot"
  | "musicalInstrumentSmall"
  | "musicalInstrumentMedium"
  | "guitar"
  | "keyboardPiano"
  | "droneSmall"
  | "droneLarge"
  | "medicalSmall"
  | "medicalMedium"
  | "smallAppliance"
  | "mediumAppliance"
  | "powerToolBare"
  | "powerToolWithBattery"
  | "powerToolKit"
  | "sportsSmall"
  | "sportsMedium"
  | "sportsLong"
  | "collectibleSmall"
  | "collectibleFigure"
  | "collectibleLarge"
  | "speakerSmall"
  | "speakerMedium"
  | "speakerLarge"
  | "monitorSmall"
  | "monitorLarge"
  | "carPartSmall"
  | "carPartMedium"
  | "carPartLarge"
  | "battery"
  | "toolKitHeavy"
  | "bundleSmall"
  | "bundleMedium"
  | "bundleLargeMultiBox";

export type FragilityTier =
  | "NORMAL"
  | "FRAGILE"
  | "GLASS"
  | "HIGH_THEFT"
  | "HEAVY_DENSE"
  | "HEAVY_DENSE_OVERSIZE"
  | "FRAGILE_HEAVY"
  | "FRAGILE_HEAVY_OVERSIZE"
  | "FRAGILE_OVERSIZE"
  | "GLASS_OVERSIZE"
  | "OVERSIZE"
  | "OVERSIZE_LENGTH"
  | "HAZMAT"
  | "MIXED"
  | "MIXED_OVERSIZE";

export type HazmatFlag =
  | "LITHIUM_BATTERY"
  | "LITHIUM_BATTERY_POSSIBLE"
  | "STATIC_SENSITIVE"
  | "MEDICAL_DEVICE"
  | "FLUID_RESIDUE_POSSIBLE"
  | "UNKNOWN_BUNDLE";

export type PackagingProfile = {
  group: string;
  box: {
    lengthIn: number;
    widthIn: number;
    heightIn: number;
  };
  packagingWeightLbs: number;
  fragilityTier: FragilityTier;
  hazmatFlags: HazmatFlag[];
  highTheft: boolean;
  insurance: boolean;
  materialCostUsd: number;
  laborCostUsd: number;
  multiBoxEligible: boolean;
};

export type PackagingSourceConfidence =
  | "ACTUAL_DIMENSIONS"
  | "TITLE_MATCH_HIGH"
  | "TITLE_MATCH_MEDIUM"
  | "CATEGORY_MATCH"
  | "WEIGHT_FALLBACK";

export type SurchargeEstimate = {
  residentialSurchargeUsd: number;
  fuelSurchargeUsd: number;
  remoteAreaSurchargeUsd: number;
  oversizeSurchargeRiskUsd: number;
  additionalHandlingRiskUsd: number;
  lithiumBatteryHandlingRiskUsd: number;
  totalSurchargeRiskUsd: number;
  flags: string[];
};

export type PackagingCostBreakdown = {
  boxCostUsd: number;
  bubbleWrapCostUsd: number;
  foamCostUsd: number;
  tapeCostUsd: number;
  labelCostUsd: number;
  polyMailerCostUsd: number;
  insertCostUsd: number;
  laborPickInspectPackUsd: number;
  laborPhotoWeighLabelUsd: number;
  totalMaterialCostUsd: number;
  totalLaborCostUsd: number;
  estimatedTotalPackagingCostUsd: number;
};

export type PackagingLearningDelta = {
  estimatedProfileKey: PackagingProfileKey;
  actualLengthIn?: number;
  actualWidthIn?: number;
  actualHeightIn?: number;
  actualPackedWeightLbs?: number;
  actualPackagingCostUsd?: number;
  dimensionDeltaPct?: number;
  weightDeltaPct?: number;
  costDeltaUsd?: number;
  recommendation: "KEEP_PROFILE" | "ADJUST_PROFILE" | "SPLIT_PROFILE" | "HUMAN_REVIEW";
  reason: string;
};

export type BillableWeightResult = {
  profileKey: PackagingProfileKey;
  packedWeightLbs: number;
  dimensionalWeightLbs: number;
  billableWeightLbs: number;
  pricedBy: "ACTUAL_WEIGHT" | "DIMENSIONAL_WEIGHT";
  carrierDivisor: number;
  matchedAlias?: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidenceSource: PackagingSourceConfidence;
  humanReviewRequired: boolean;
  box: PackagingProfile["box"];
  packageCount: number;
  multiBoxRecommended: boolean;
  fragile: boolean;
  fragilityTier: FragilityTier;
  insurance: boolean;
  highTheft: boolean;
  hazmatFlags: HazmatFlag[];
  oversize: boolean;
  additionalHandlingLikely: boolean;
  costBreakdown: PackagingCostBreakdown;
  surchargeEstimate: SurchargeEstimate;
  riskReserveUsd: number;
  estimatedPackagingAndRiskCostUsd: number;
  learning?: PackagingLearningDelta;
};

export const packagingProfiles: Record<PackagingProfileKey, PackagingProfile> = {
  iphone: {
    group: "electronics",
    box: { lengthIn: 8, widthIn: 6, heightIn: 3 },
    packagingWeightLbs: 0.5,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 2.25,
    laborCostUsd: 3.25,
    multiBoxEligible: false,
  },
  smartphone: {
    group: "electronics",
    box: { lengthIn: 8, widthIn: 6, heightIn: 3 },
    packagingWeightLbs: 0.5,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 2.25,
    laborCostUsd: 3.25,
    multiBoxEligible: false,
  },
  earbuds: {
    group: "electronics",
    box: { lengthIn: 7, widthIn: 5, heightIn: 3 },
    packagingWeightLbs: 0.35,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 1.75,
    laborCostUsd: 2.75,
    multiBoxEligible: false,
  },
  tablet: {
    group: "electronics",
    box: { lengthIn: 13, widthIn: 10, heightIn: 3 },
    packagingWeightLbs: 0.9,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 3.5,
    laborCostUsd: 4.25,
    multiBoxEligible: false,
  },
  laptop: {
    group: "electronics",
    box: { lengthIn: 18, widthIn: 14, heightIn: 4 },
    packagingWeightLbs: 1.5,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 5.75,
    laborCostUsd: 5.5,
    multiBoxEligible: false,
  },
  desktopMiniPc: {
    group: "electronics",
    box: { lengthIn: 12, widthIn: 10, heightIn: 6 },
    packagingWeightLbs: 1.4,
    fragilityTier: "FRAGILE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 4.25,
    laborCostUsd: 4.75,
    multiBoxEligible: false,
  },
  gameConsole: {
    group: "gameConsole",
    box: { lengthIn: 18, widthIn: 14, heightIn: 8 },
    packagingWeightLbs: 2.0,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY_POSSIBLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 6.25,
    laborCostUsd: 5.75,
    multiBoxEligible: false,
  },
  handheldConsole: {
    group: "gameConsole",
    box: { lengthIn: 12, widthIn: 8, heightIn: 4 },
    packagingWeightLbs: 0.9,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 3.25,
    laborCostUsd: 4.25,
    multiBoxEligible: false,
  },
  graphicsCard: {
    group: "computerParts",
    box: { lengthIn: 16, widthIn: 12, heightIn: 6 },
    packagingWeightLbs: 1.3,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["STATIC_SENSITIVE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 5.25,
    laborCostUsd: 5.25,
    multiBoxEligible: false,
  },
  camera: {
    group: "camera",
    box: { lengthIn: 12, widthIn: 10, heightIn: 6 },
    packagingWeightLbs: 1.1,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY_POSSIBLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 4.5,
    laborCostUsd: 5.25,
    multiBoxEligible: false,
  },
  cameraLens: {
    group: "camera",
    box: { lengthIn: 10, widthIn: 8, heightIn: 6 },
    packagingWeightLbs: 0.9,
    fragilityTier: "GLASS",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 4.75,
    laborCostUsd: 5.5,
    multiBoxEligible: false,
  },
  networkDevice: {
    group: "network",
    box: { lengthIn: 14, widthIn: 10, heightIn: 5 },
    packagingWeightLbs: 1.0,
    fragilityTier: "FRAGILE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 3.85,
    laborCostUsd: 4.25,
    multiBoxEligible: false,
  },
  smallElectronics: {
    group: "electronics",
    box: { lengthIn: 10, widthIn: 8, heightIn: 4 },
    packagingWeightLbs: 0.8,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY_POSSIBLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 3.0,
    laborCostUsd: 3.75,
    multiBoxEligible: false,
  },
  mediumElectronics: {
    group: "electronics",
    box: { lengthIn: 14, widthIn: 10, heightIn: 6 },
    packagingWeightLbs: 1.2,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY_POSSIBLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 4.25,
    laborCostUsd: 4.75,
    multiBoxEligible: false,
  },
  largeElectronics: {
    group: "electronics",
    box: { lengthIn: 20, widthIn: 16, heightIn: 8 },
    packagingWeightLbs: 2.5,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY_POSSIBLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 8.25,
    laborCostUsd: 7.25,
    multiBoxEligible: false,
  },
  automotiveHandTool: {
    group: "automotiveTool",
    box: { lengthIn: 12, widthIn: 8, heightIn: 4 },
    packagingWeightLbs: 0.8,
    fragilityTier: "HEAVY_DENSE",
    hazmatFlags: [],
    highTheft: false,
    insurance: true,
    materialCostUsd: 2.85,
    laborCostUsd: 3.75,
    multiBoxEligible: false,
  },
  automotivePowerTool: {
    group: "automotiveTool",
    box: { lengthIn: 18, widthIn: 14, heightIn: 8 },
    packagingWeightLbs: 2.0,
    fragilityTier: "HEAVY_DENSE",
    hazmatFlags: ["LITHIUM_BATTERY_POSSIBLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 6.0,
    laborCostUsd: 5.75,
    multiBoxEligible: false,
  },
  gardenHandTool: {
    group: "gardenTool",
    box: { lengthIn: 18, widthIn: 8, heightIn: 6 },
    packagingWeightLbs: 1.2,
    fragilityTier: "NORMAL",
    hazmatFlags: [],
    highTheft: false,
    insurance: false,
    materialCostUsd: 4.25,
    laborCostUsd: 4.25,
    multiBoxEligible: false,
  },
  gardenPowerTool: {
    group: "gardenTool",
    box: { lengthIn: 24, widthIn: 14, heightIn: 10 },
    packagingWeightLbs: 3.0,
    fragilityTier: "HEAVY_DENSE",
    hazmatFlags: ["LITHIUM_BATTERY_POSSIBLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 9.5,
    laborCostUsd: 7.25,
    multiBoxEligible: false,
  },
  longGardenTool: {
    group: "gardenTool",
    box: { lengthIn: 48, widthIn: 8, heightIn: 6 },
    packagingWeightLbs: 3.5,
    fragilityTier: "OVERSIZE_LENGTH",
    hazmatFlags: [],
    highTheft: false,
    insurance: false,
    materialCostUsd: 12.75,
    laborCostUsd: 8.0,
    multiBoxEligible: false,
  },
  otherWeightOnlySmall: {
    group: "other",
    box: { lengthIn: 10, widthIn: 8, heightIn: 4 },
    packagingWeightLbs: 0.75,
    fragilityTier: "NORMAL",
    hazmatFlags: [],
    highTheft: false,
    insurance: false,
    materialCostUsd: 2.25,
    laborCostUsd: 3.25,
    multiBoxEligible: false,
  },
  otherWeightOnlyMedium: {
    group: "other",
    box: { lengthIn: 14, widthIn: 10, heightIn: 6 },
    packagingWeightLbs: 1.25,
    fragilityTier: "NORMAL",
    hazmatFlags: [],
    highTheft: false,
    insurance: false,
    materialCostUsd: 3.75,
    laborCostUsd: 4.25,
    multiBoxEligible: false,
  },
  otherWeightOnlyLarge: {
    group: "other",
    box: { lengthIn: 20, widthIn: 16, heightIn: 10 },
    packagingWeightLbs: 2.5,
    fragilityTier: "NORMAL",
    hazmatFlags: [],
    highTheft: false,
    insurance: false,
    materialCostUsd: 7.5,
    laborCostUsd: 6.25,
    multiBoxEligible: false,
  },
  otherWeightOnlyOversize: {
    group: "other",
    box: { lengthIn: 28, widthIn: 20, heightIn: 14 },
    packagingWeightLbs: 4.0,
    fragilityTier: "OVERSIZE",
    hazmatFlags: [],
    highTheft: false,
    insurance: false,
    materialCostUsd: 14.0,
    laborCostUsd: 9.0,
    multiBoxEligible: false,
  },
  watch: {
    group: "jewelryWatch",
    box: { lengthIn: 8, widthIn: 6, heightIn: 4 },
    packagingWeightLbs: 0.55,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY_POSSIBLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 3.0,
    laborCostUsd: 4.5,
    multiBoxEligible: false,
  },
  jewelrySmall: {
    group: "jewelryWatch",
    box: { lengthIn: 7, widthIn: 5, heightIn: 3 },
    packagingWeightLbs: 0.35,
    fragilityTier: "HIGH_THEFT",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 2.75,
    laborCostUsd: 4.75,
    multiBoxEligible: false,
  },
  jewelryLot: {
    group: "jewelryWatch",
    box: { lengthIn: 10, widthIn: 8, heightIn: 4 },
    packagingWeightLbs: 0.75,
    fragilityTier: "HIGH_THEFT",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 3.75,
    laborCostUsd: 6.0,
    multiBoxEligible: false,
  },
  musicalInstrumentSmall: {
    group: "musical",
    box: { lengthIn: 16, widthIn: 12, heightIn: 6 },
    packagingWeightLbs: 1.5,
    fragilityTier: "FRAGILE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 6.25,
    laborCostUsd: 6.25,
    multiBoxEligible: false,
  },
  musicalInstrumentMedium: {
    group: "musical",
    box: { lengthIn: 24, widthIn: 16, heightIn: 8 },
    packagingWeightLbs: 3.0,
    fragilityTier: "FRAGILE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 11.5,
    laborCostUsd: 9.5,
    multiBoxEligible: false,
  },
  guitar: {
    group: "musical",
    box: { lengthIn: 44, widthIn: 18, heightIn: 8 },
    packagingWeightLbs: 5.5,
    fragilityTier: "FRAGILE_OVERSIZE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 22.0,
    laborCostUsd: 13.5,
    multiBoxEligible: false,
  },
  keyboardPiano: {
    group: "musical",
    box: { lengthIn: 44, widthIn: 16, heightIn: 8 },
    packagingWeightLbs: 5.0,
    fragilityTier: "FRAGILE_OVERSIZE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 20.0,
    laborCostUsd: 12.0,
    multiBoxEligible: false,
  },
  droneSmall: {
    group: "drone",
    box: { lengthIn: 12, widthIn: 10, heightIn: 6 },
    packagingWeightLbs: 1.1,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 4.75,
    laborCostUsd: 5.25,
    multiBoxEligible: false,
  },
  droneLarge: {
    group: "drone",
    box: { lengthIn: 18, widthIn: 14, heightIn: 8 },
    packagingWeightLbs: 2.5,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 7.75,
    laborCostUsd: 7.25,
    multiBoxEligible: false,
  },
  medicalSmall: {
    group: "medical",
    box: { lengthIn: 12, widthIn: 8, heightIn: 6 },
    packagingWeightLbs: 1.0,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["MEDICAL_DEVICE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 4.25,
    laborCostUsd: 5.5,
    multiBoxEligible: false,
  },
  medicalMedium: {
    group: "medical",
    box: { lengthIn: 18, widthIn: 14, heightIn: 8 },
    packagingWeightLbs: 2.5,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["MEDICAL_DEVICE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 7.75,
    laborCostUsd: 7.5,
    multiBoxEligible: false,
  },
  smallAppliance: {
    group: "appliance",
    box: { lengthIn: 14, widthIn: 12, heightIn: 8 },
    packagingWeightLbs: 1.75,
    fragilityTier: "FRAGILE",
    hazmatFlags: [],
    highTheft: false,
    insurance: true,
    materialCostUsd: 6.0,
    laborCostUsd: 5.75,
    multiBoxEligible: false,
  },
  mediumAppliance: {
    group: "appliance",
    box: { lengthIn: 20, widthIn: 16, heightIn: 12 },
    packagingWeightLbs: 3.5,
    fragilityTier: "FRAGILE",
    hazmatFlags: [],
    highTheft: false,
    insurance: true,
    materialCostUsd: 11.0,
    laborCostUsd: 8.5,
    multiBoxEligible: false,
  },
  powerToolBare: {
    group: "powerTool",
    box: { lengthIn: 16, widthIn: 12, heightIn: 6 },
    packagingWeightLbs: 1.5,
    fragilityTier: "HEAVY_DENSE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 5.25,
    laborCostUsd: 5.5,
    multiBoxEligible: false,
  },
  powerToolWithBattery: {
    group: "powerTool",
    box: { lengthIn: 18, widthIn: 14, heightIn: 8 },
    packagingWeightLbs: 2.25,
    fragilityTier: "HEAVY_DENSE",
    hazmatFlags: ["LITHIUM_BATTERY"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 6.75,
    laborCostUsd: 6.25,
    multiBoxEligible: false,
  },
  powerToolKit: {
    group: "powerTool",
    box: { lengthIn: 22, widthIn: 16, heightIn: 10 },
    packagingWeightLbs: 3.5,
    fragilityTier: "HEAVY_DENSE",
    hazmatFlags: ["LITHIUM_BATTERY_POSSIBLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 10.5,
    laborCostUsd: 8.5,
    multiBoxEligible: false,
  },
  sportsSmall: {
    group: "sports",
    box: { lengthIn: 14, widthIn: 10, heightIn: 6 },
    packagingWeightLbs: 1.0,
    fragilityTier: "NORMAL",
    hazmatFlags: [],
    highTheft: false,
    insurance: false,
    materialCostUsd: 4.0,
    laborCostUsd: 4.25,
    multiBoxEligible: false,
  },
  sportsMedium: {
    group: "sports",
    box: { lengthIn: 24, widthIn: 12, heightIn: 8 },
    packagingWeightLbs: 2.5,
    fragilityTier: "NORMAL",
    hazmatFlags: [],
    highTheft: false,
    insurance: false,
    materialCostUsd: 8.75,
    laborCostUsd: 6.25,
    multiBoxEligible: false,
  },
  sportsLong: {
    group: "sports",
    box: { lengthIn: 48, widthIn: 8, heightIn: 6 },
    packagingWeightLbs: 3.5,
    fragilityTier: "OVERSIZE_LENGTH",
    hazmatFlags: [],
    highTheft: false,
    insurance: false,
    materialCostUsd: 12.75,
    laborCostUsd: 8.25,
    multiBoxEligible: false,
  },
  collectibleSmall: {
    group: "collectible",
    box: { lengthIn: 10, widthIn: 8, heightIn: 4 },
    packagingWeightLbs: 0.8,
    fragilityTier: "FRAGILE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 3.5,
    laborCostUsd: 5.25,
    multiBoxEligible: false,
  },
  collectibleFigure: {
    group: "collectible",
    box: { lengthIn: 14, widthIn: 10, heightIn: 6 },
    packagingWeightLbs: 1.1,
    fragilityTier: "FRAGILE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 4.75,
    laborCostUsd: 5.75,
    multiBoxEligible: false,
  },
  collectibleLarge: {
    group: "collectible",
    box: { lengthIn: 20, widthIn: 16, heightIn: 10 },
    packagingWeightLbs: 2.5,
    fragilityTier: "FRAGILE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 9.25,
    laborCostUsd: 8.0,
    multiBoxEligible: false,
  },
  speakerSmall: {
    group: "audio",
    box: { lengthIn: 12, widthIn: 10, heightIn: 8 },
    packagingWeightLbs: 1.5,
    fragilityTier: "FRAGILE",
    hazmatFlags: ["LITHIUM_BATTERY_POSSIBLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 5.25,
    laborCostUsd: 5.25,
    multiBoxEligible: false,
  },
  speakerMedium: {
    group: "audio",
    box: { lengthIn: 18, widthIn: 14, heightIn: 12 },
    packagingWeightLbs: 3.0,
    fragilityTier: "FRAGILE_HEAVY",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 10.5,
    laborCostUsd: 8.0,
    multiBoxEligible: false,
  },
  speakerLarge: {
    group: "audio",
    box: { lengthIn: 26, widthIn: 18, heightIn: 16 },
    packagingWeightLbs: 5.0,
    fragilityTier: "FRAGILE_HEAVY_OVERSIZE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 18.0,
    laborCostUsd: 12.0,
    multiBoxEligible: false,
  },
  monitorSmall: {
    group: "monitor",
    box: { lengthIn: 22, widthIn: 16, heightIn: 6 },
    packagingWeightLbs: 3.0,
    fragilityTier: "GLASS",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 11.5,
    laborCostUsd: 8.5,
    multiBoxEligible: false,
  },
  monitorLarge: {
    group: "monitor",
    box: { lengthIn: 30, widthIn: 20, heightIn: 8 },
    packagingWeightLbs: 5.0,
    fragilityTier: "GLASS_OVERSIZE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 18.5,
    laborCostUsd: 12.5,
    multiBoxEligible: false,
  },
  carPartSmall: {
    group: "carPart",
    box: { lengthIn: 12, widthIn: 10, heightIn: 6 },
    packagingWeightLbs: 1.2,
    fragilityTier: "HEAVY_DENSE",
    hazmatFlags: [],
    highTheft: false,
    insurance: true,
    materialCostUsd: 4.25,
    laborCostUsd: 4.75,
    multiBoxEligible: false,
  },
  carPartMedium: {
    group: "carPart",
    box: { lengthIn: 20, widthIn: 14, heightIn: 10 },
    packagingWeightLbs: 3.0,
    fragilityTier: "HEAVY_DENSE",
    hazmatFlags: ["FLUID_RESIDUE_POSSIBLE"],
    highTheft: false,
    insurance: true,
    materialCostUsd: 9.5,
    laborCostUsd: 7.25,
    multiBoxEligible: false,
  },
  carPartLarge: {
    group: "carPart",
    box: { lengthIn: 30, widthIn: 20, heightIn: 12 },
    packagingWeightLbs: 6.0,
    fragilityTier: "HEAVY_DENSE_OVERSIZE",
    hazmatFlags: ["FLUID_RESIDUE_POSSIBLE"],
    highTheft: false,
    insurance: true,
    materialCostUsd: 18.0,
    laborCostUsd: 12.0,
    multiBoxEligible: false,
  },
  battery: {
    group: "battery",
    box: { lengthIn: 10, widthIn: 8, heightIn: 6 },
    packagingWeightLbs: 1.25,
    fragilityTier: "HAZMAT",
    hazmatFlags: ["LITHIUM_BATTERY"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 5.25,
    laborCostUsd: 6.5,
    multiBoxEligible: false,
  },
  toolKitHeavy: {
    group: "tool",
    box: { lengthIn: 20, widthIn: 14, heightIn: 8 },
    packagingWeightLbs: 3.0,
    fragilityTier: "HEAVY_DENSE",
    hazmatFlags: [],
    highTheft: true,
    insurance: true,
    materialCostUsd: 8.75,
    laborCostUsd: 7.5,
    multiBoxEligible: false,
  },
  bundleSmall: {
    group: "bundle",
    box: { lengthIn: 14, widthIn: 10, heightIn: 6 },
    packagingWeightLbs: 1.5,
    fragilityTier: "MIXED",
    hazmatFlags: ["UNKNOWN_BUNDLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 5.5,
    laborCostUsd: 7.5,
    multiBoxEligible: false,
  },
  bundleMedium: {
    group: "bundle",
    box: { lengthIn: 20, widthIn: 16, heightIn: 10 },
    packagingWeightLbs: 3.0,
    fragilityTier: "MIXED",
    hazmatFlags: ["UNKNOWN_BUNDLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 10.5,
    laborCostUsd: 10.0,
    multiBoxEligible: false,
  },
  bundleLargeMultiBox: {
    group: "bundle",
    box: { lengthIn: 24, widthIn: 18, heightIn: 12 },
    packagingWeightLbs: 4.0,
    fragilityTier: "MIXED_OVERSIZE",
    hazmatFlags: ["UNKNOWN_BUNDLE"],
    highTheft: true,
    insurance: true,
    materialCostUsd: 18.0,
    laborCostUsd: 15.0,
    multiBoxEligible: true,
  }
};

export const packagingProfileAliases: Record<PackagingProfileKey, string[]> = {
  iphone: ["iphone", "iphone 11", "iphone 12", "iphone 13", "iphone 14", "iphone 15", "iphone 16", "iphone se", "iphone xr", "iphone xs", "iphone kit", "iphone lot", "iphone pro", "iphone plus", "iphone used", "apple iphone", "iphone parts", "iphone 11 kit", "iphone 11 lot", "iphone 12 kit", "iphone 12 lot", "iphone 13 kit", "iphone 13 lot", "iphone 14 kit", "iphone 14 lot", "iphone 15 kit", "iphone 15 lot", "iphone 16 kit", "iphone 16 lot", "iphone bundle", "iphone se kit", "iphone se lot", "iphone tested", "iphone xr kit", "iphone xr lot", "iphone xs kit", "iphone xs lot", "apple iphone 6", "apple iphone 7", "apple iphone 8", "apple iphone x", "iphone 11 used", "iphone 12 used", "iphone 13 used", "iphone 14 used", "iphone 15 used", "iphone 16 used", "iphone pro kit", "iphone pro lot", "iphone pro max", "iphone se used", "iphone working", "iphone xr used", "iphone xs used", "iphone 11 parts", "iphone 12 parts", "iphone 13 parts", "iphone 14 parts", "iphone 15 parts", "iphone 16 parts", "iphone plus kit", "iphone plus lot", "iphone pro used", "iphone se parts", "iphone xr parts", "iphone xs parts", "apple iphone kit", "apple iphone lot", "iphone 11 bundle", "iphone 11 tested", "iphone 12 bundle", "iphone 12 tested", "iphone 13 bundle", "iphone 13 tested", "iphone 14 bundle", "iphone 14 tested", "iphone 15 bundle", "iphone 15 tested", "iphone 16 bundle", "iphone 16 tested", "iphone plus used", "iphone pro parts", "iphone se bundle", "iphone se tested", "iphone xr bundle", "iphone xr tested", "iphone xs bundle", "iphone xs tested", "apple iphone used", "iphone 11 working", "iphone 12 working", "iphone 13 working", "iphone 14 working", "iphone 15 working", "iphone 16 working", "iphone plus parts", "iphone pro bundle", "iphone pro tested", "iphone se working", "iphone xr working", "iphone xs working", "apple iphone 6 kit", "apple iphone 6 lot", "apple iphone 7 kit", "apple iphone 7 lot", "apple iphone 8 kit", "apple iphone 8 lot", "apple iphone parts", "apple iphone x kit", "apple iphone x lot", "iphone accessories", "iphone plus bundle", "iphone plus tested", "iphone pro max kit", "iphone pro max lot", "iphone pro working", "apple iphone 11 pro", "apple iphone 12 pro", "apple iphone 13 pro", "apple iphone 14 pro", "apple iphone 15 pro", "apple iphone 16 pro", "apple iphone 6 used", "apple iphone 7 used", "apple iphone 8 used", "apple iphone bundle", "apple iphone tested", "apple iphone x used", "iphone plus working", "iphone pro max used", "iphone with charger", "apple iphone 6 parts", "apple iphone 7 parts", "apple iphone 8 parts", "apple iphone working", "apple iphone x parts", "iphone pro max parts", "apple iphone 6 bundle", "apple iphone 6 tested", "apple iphone 7 bundle", "apple iphone 7 tested", "apple iphone 8 bundle", "apple iphone 8 tested", "apple iphone x bundle", "apple iphone x tested", "iphone 11 accessories", "iphone 12 accessories", "iphone 13 accessories", "iphone 14 accessories", "iphone 15 accessories", "iphone 16 accessories", "iphone pro max bundle", "iphone pro max tested", "iphone se accessories", "iphone xr accessories", "iphone xs accessories", "apple iphone 6 working", "apple iphone 7 working", "apple iphone 8 working", "apple iphone x working", "iphone 11 with charger", "iphone 12 with charger", "iphone 13 with charger", "iphone 14 with charger", "iphone 15 with charger", "iphone 16 with charger", "iphone pro accessories", "iphone pro max working", "iphone se with charger", "iphone xr with charger", "iphone xs with charger", "apple iphone 11 pro kit", "apple iphone 11 pro lot", "apple iphone 12 pro kit", "apple iphone 12 pro lot", "apple iphone 13 pro kit", "apple iphone 13 pro lot", "apple iphone 14 pro kit", "apple iphone 14 pro lot", "apple iphone 15 pro kit", "apple iphone 15 pro lot", "apple iphone 16 pro kit", "apple iphone 16 pro lot", "iphone plus accessories", "iphone pro with charger", "apple iphone 11 pro used", "apple iphone 12 pro used", "apple iphone 13 pro used", "apple iphone 14 pro used", "apple iphone 15 pro used", "apple iphone 16 pro used", "apple iphone accessories", "iphone plus with charger", "apple iphone 11 pro parts", "apple iphone 12 pro parts", "apple iphone 13 pro parts", "apple iphone 14 pro parts", "apple iphone 15 pro parts", "apple iphone 16 pro parts", "apple iphone with charger", "apple iphone 11 pro bundle", "apple iphone 11 pro tested", "apple iphone 12 pro bundle", "apple iphone 12 pro tested", "apple iphone 13 pro bundle", "apple iphone 13 pro tested", "apple iphone 14 pro bundle", "apple iphone 14 pro tested", "apple iphone 15 pro bundle", "apple iphone 15 pro tested", "apple iphone 16 pro bundle", "apple iphone 16 pro tested", "apple iphone 6 accessories", "apple iphone 7 accessories", "apple iphone 8 accessories", "apple iphone x accessories", "iphone pro max accessories", "apple iphone 11 pro working", "apple iphone 12 pro working", "apple iphone 13 pro working", "apple iphone 14 pro working", "apple iphone 15 pro working", "apple iphone 16 pro working", "apple iphone 6 with charger", "apple iphone 7 with charger", "apple iphone 8 with charger", "apple iphone x with charger", "iphone pro max with charger", "apple iphone 11 pro accessories", "apple iphone 12 pro accessories", "apple iphone 13 pro accessories", "apple iphone 14 pro accessories", "apple iphone 15 pro accessories", "apple iphone 16 pro accessories", "apple iphone 11 pro with charger", "apple iphone 12 pro with charger", "apple iphone 13 pro with charger", "apple iphone 14 pro with charger", "apple iphone 15 pro with charger", "apple iphone 16 pro with charger"],
  smartphone: ["phone", "moto g", "oneplus", "galaxy s", "lg phone", "blu phone", "cat phone", "phone kit", "phone lot", "tcl phone", "zte phone", "cell phone", "moto g kit", "moto g lot", "oneplus 10", "oneplus 11", "oneplus 12", "phone used", "smartphone", "galaxy note", "moto g used", "nokia phone", "oneplus kit", "oneplus lot", "phone parts", "sony xperia", "galaxy s kit", "galaxy s lot", "google pixel", "huawei phone", "lg phone kit", "lg phone lot", "mobile phone", "moto g parts", "oneplus used", "phone bundle", "phone tested", "rugged phone", "android phone", "blu phone kit", "blu phone lot", "cat phone kit", "cat phone lot", "galaxy s used", "galaxy z flip", "galaxy z fold", "kyocera phone", "lg phone used", "moto g bundle", "moto g tested", "oneplus parts", "phone working", "tcl phone kit", "tcl phone lot", "zte phone kit", "zte phone lot", "blu phone used", "cat phone used", "cell phone kit", "cell phone lot", "galaxy s parts", "google pixel 6", "google pixel 7", "google pixel 8", "google pixel 9", "lg phone parts", "moto g working", "motorola phone", "oneplus 10 kit", "oneplus 10 lot", "oneplus 11 kit", "oneplus 11 lot", "oneplus 12 kit", "oneplus 12 lot", "oneplus bundle", "oneplus tested", "samsung galaxy", "smartphone kit", "smartphone lot", "tcl phone used", "zte phone used", "blu phone parts", "cat phone parts", "cell phone used", "galaxy note kit", "galaxy note lot", "galaxy s bundle", "galaxy s tested", "lg phone bundle", "lg phone tested", "nokia phone kit", "nokia phone lot", "oneplus 10 used", "oneplus 11 used", "oneplus 12 used", "oneplus working", "smartphone used", "sony xperia kit", "sony xperia lot", "tcl phone parts", "zte phone parts", "blu phone bundle", "blu phone tested", "cat phone bundle", "cat phone tested", "cell phone parts", "galaxy note used", "galaxy s working", "google pixel kit", "google pixel lot", "huawei phone kit", "huawei phone lot", "lg phone working", "mobile phone kit", "mobile phone lot", "nokia phone used", "oneplus 10 parts", "oneplus 11 parts", "oneplus 12 parts", "rugged phone kit", "rugged phone lot", "smartphone parts", "sony xperia used", "tcl phone bundle", "tcl phone tested", "zte phone bundle", "zte phone tested", "android phone kit", "android phone lot", "blu phone working", "cat phone working", "cell phone bundle", "cell phone tested", "galaxy note parts", "galaxy z flip kit", "galaxy z flip lot", "galaxy z fold kit", "galaxy z fold lot", "google pixel used", "huawei phone used", "kyocera phone kit", "kyocera phone lot", "mobile phone used", "nokia phone parts", "oneplus 10 bundle", "oneplus 10 tested", "oneplus 11 bundle", "oneplus 11 tested", "oneplus 12 bundle", "oneplus 12 tested", "phone accessories", "rugged phone used", "smartphone bundle", "smartphone tested", "sony xperia parts", "tcl phone working", "zte phone working", "android phone used", "cell phone working", "galaxy note bundle", "galaxy note tested", "galaxy z flip used", "galaxy z fold used", "google pixel 6 kit", "google pixel 6 lot", "google pixel 7 kit", "google pixel 7 lot", "google pixel 8 kit", "google pixel 8 lot", "google pixel 9 kit", "google pixel 9 lot", "google pixel parts", "huawei phone parts", "kyocera phone used", "mobile phone parts", "moto g accessories", "motorola phone kit", "motorola phone lot", "nokia phone bundle", "nokia phone tested", "oneplus 10 working", "oneplus 11 working", "oneplus 12 working", "phone with charger", "rugged phone parts", "samsung galaxy kit", "samsung galaxy lot", "samsung galaxy s20", "samsung galaxy s21", "samsung galaxy s22", "samsung galaxy s23", "samsung galaxy s24", "smartphone working", "sony xperia bundle", "sony xperia tested", "android phone parts", "galaxy note working", "galaxy z flip parts", "galaxy z fold parts", "google pixel 6 used", "google pixel 7 used", "google pixel 8 used", "google pixel 9 used", "google pixel bundle", "google pixel tested", "huawei phone bundle", "huawei phone tested", "kyocera phone parts", "mobile phone bundle", "mobile phone tested", "moto g with charger", "motorola phone used", "nokia phone working", "oneplus accessories", "rugged phone bundle", "rugged phone tested", "samsung galaxy used", "sony xperia working", "android phone bundle", "android phone tested", "galaxy s accessories", "galaxy z flip bundle", "galaxy z flip tested", "galaxy z fold bundle", "galaxy z fold tested", "google pixel 6 parts", "google pixel 7 parts", "google pixel 8 parts", "google pixel 9 parts", "google pixel working", "huawei phone working", "kyocera phone bundle", "kyocera phone tested", "lg phone accessories", "mobile phone working", "motorola phone parts", "oneplus with charger", "rugged phone working", "samsung galaxy parts", "android phone working", "blu phone accessories", "cat phone accessories", "galaxy s with charger", "galaxy z flip working", "galaxy z fold working", "google pixel 6 bundle", "google pixel 6 tested", "google pixel 7 bundle", "google pixel 7 tested", "google pixel 8 bundle", "google pixel 8 tested", "google pixel 9 bundle", "google pixel 9 tested", "kyocera phone working", "lg phone with charger", "motorola phone bundle", "motorola phone tested", "samsung galaxy bundle", "samsung galaxy tested", "tcl phone accessories", "zte phone accessories", "blu phone with charger", "cat phone with charger", "cell phone accessories", "google pixel 6 working", "google pixel 7 working", "google pixel 8 working", "google pixel 9 working", "motorola phone working", "oneplus 10 accessories", "oneplus 11 accessories", "oneplus 12 accessories", "samsung galaxy s20 kit", "samsung galaxy s20 lot", "samsung galaxy s21 kit", "samsung galaxy s21 lot", "samsung galaxy s22 kit", "samsung galaxy s22 lot", "samsung galaxy s23 kit", "samsung galaxy s23 lot", "samsung galaxy s24 kit", "samsung galaxy s24 lot", "samsung galaxy working", "smartphone accessories", "tcl phone with charger", "zte phone with charger", "cell phone with charger", "galaxy note accessories", "nokia phone accessories", "oneplus 10 with charger", "oneplus 11 with charger", "oneplus 12 with charger", "samsung galaxy s20 used", "samsung galaxy s21 used", "samsung galaxy s22 used", "samsung galaxy s23 used", "samsung galaxy s24 used", "smartphone with charger", "sony xperia accessories", "galaxy note with charger", "google pixel accessories", "huawei phone accessories", "mobile phone accessories", "nokia phone with charger", "rugged phone accessories", "samsung galaxy s20 parts", "samsung galaxy s21 parts", "samsung galaxy s22 parts", "samsung galaxy s23 parts", "samsung galaxy s24 parts", "sony xperia with charger", "android phone accessories", "galaxy z flip accessories", "galaxy z fold accessories", "google pixel with charger", "huawei phone with charger", "kyocera phone accessories", "mobile phone with charger", "rugged phone with charger", "samsung galaxy s20 bundle", "samsung galaxy s20 tested", "samsung galaxy s21 bundle", "samsung galaxy s21 tested", "samsung galaxy s22 bundle", "samsung galaxy s22 tested", "samsung galaxy s23 bundle", "samsung galaxy s23 tested", "samsung galaxy s24 bundle", "samsung galaxy s24 tested", "android phone with charger", "galaxy z flip with charger", "galaxy z fold with charger", "google pixel 6 accessories", "google pixel 7 accessories", "google pixel 8 accessories", "google pixel 9 accessories", "kyocera phone with charger", "motorola phone accessories", "samsung galaxy accessories", "samsung galaxy s20 working", "samsung galaxy s21 working", "samsung galaxy s22 working", "samsung galaxy s23 working", "samsung galaxy s24 working", "google pixel 6 with charger", "google pixel 7 with charger", "google pixel 8 with charger", "google pixel 9 with charger", "motorola phone with charger", "samsung galaxy with charger", "samsung galaxy s20 accessories", "samsung galaxy s21 accessories", "samsung galaxy s22 accessories", "samsung galaxy s23 accessories", "samsung galaxy s24 accessories", "samsung galaxy s20 with charger", "samsung galaxy s21 with charger", "samsung galaxy s22 with charger", "samsung galaxy s23 with charger", "samsung galaxy s24 with charger"],
  earbuds: ["airpods", "earbuds", "earpods", "ear buds", "ear pods", "pixel buds", "airpods kit", "airpods lot", "airpods max", "airpods pro", "earbud case", "earbuds kit", "earbuds lot", "earpods kit", "earpods lot", "galaxy buds", "airpods used", "bose earbuds", "ear buds kit", "ear buds lot", "ear pods kit", "ear pods lot", "earbuds used", "earpods used", "sony earbuds", "airpods parts", "anker earbuds", "beats earbuds", "beats fit pro", "charging case", "ear buds used", "ear pods used", "earbuds parts", "earpods parts", "jabra earbuds", "airpods bundle", "airpods tested", "ear buds parts", "ear pods parts", "earbuds bundle", "earbuds tested", "earpods bundle", "earpods tested", "pixel buds kit", "pixel buds lot", "airpods max kit", "airpods max lot", "airpods pro kit", "airpods pro lot", "airpods working", "ear buds bundle", "ear buds tested", "ear pods bundle", "ear pods tested", "earbud case kit", "earbud case lot", "earbuds working", "earpods working", "galaxy buds kit", "galaxy buds lot", "pixel buds used", "airpods max used", "airpods pro used", "bose earbuds kit", "bose earbuds lot", "ear buds working", "ear pods working", "earbud case used", "galaxy buds used", "pixel buds parts", "sony earbuds kit", "sony earbuds lot", "wireless earbuds", "airpods max parts", "airpods pro parts", "anker earbuds kit", "anker earbuds lot", "beats earbuds kit", "beats earbuds lot", "beats fit pro kit", "beats fit pro lot", "beats studio buds", "bluetooth earbuds", "bose earbuds used", "charging case kit", "charging case lot", "earbud case parts", "galaxy buds parts", "hearing amplifier", "jabra earbuds kit", "jabra earbuds lot", "pixel buds bundle", "pixel buds tested", "sony earbuds used", "airpods max bundle", "airpods max tested", "airpods pro bundle", "airpods pro tested", "anker earbuds used", "beats earbuds used", "beats fit pro used", "bose earbuds parts", "charging case used", "earbud case bundle", "earbud case tested", "galaxy buds bundle", "galaxy buds tested", "jabra earbuds used", "pixel buds working", "skullcandy earbuds", "sony earbuds parts", "airpods accessories", "airpods max working", "airpods pro working", "anker earbuds parts", "beats earbuds parts", "beats fit pro parts", "bose earbuds bundle", "bose earbuds tested", "charging case parts", "earbud case working", "earbuds accessories", "earpods accessories", "galaxy buds working", "jabra earbuds parts", "sony earbuds bundle", "sony earbuds tested", "airpods with charger", "anker earbuds bundle", "anker earbuds tested", "beats earbuds bundle", "beats earbuds tested", "beats fit pro bundle", "beats fit pro tested", "bose earbuds working", "charging case bundle", "charging case tested", "ear buds accessories", "ear pods accessories", "earbuds with charger", "earpods with charger", "jabra earbuds bundle", "jabra earbuds tested", "sony earbuds working", "wireless earbuds kit", "wireless earbuds lot", "anker earbuds working", "beats earbuds working", "beats fit pro working", "beats studio buds kit", "beats studio buds lot", "bluetooth earbuds kit", "bluetooth earbuds lot", "charging case working", "ear buds with charger", "ear pods with charger", "hearing amplifier kit", "hearing amplifier lot", "jabra earbuds working", "wireless earbuds used", "beats studio buds used", "bluetooth earbuds used", "hearing amplifier used", "pixel buds accessories", "skullcandy earbuds kit", "skullcandy earbuds lot", "wireless earbuds parts", "airpods max accessories", "airpods pro accessories", "beats studio buds parts", "bluetooth earbuds parts", "earbud case accessories", "galaxy buds accessories", "hearing amplifier parts", "pixel buds with charger", "skullcandy earbuds used", "wireless earbuds bundle", "wireless earbuds tested", "airpods max with charger", "airpods pro with charger", "beats studio buds bundle", "beats studio buds tested", "bluetooth earbuds bundle", "bluetooth earbuds tested", "bose earbuds accessories", "earbud case with charger", "galaxy buds with charger", "hearing amplifier bundle", "hearing amplifier tested", "skullcandy earbuds parts", "sony earbuds accessories", "wireless earbuds working", "anker earbuds accessories", "beats earbuds accessories", "beats fit pro accessories", "beats studio buds working", "bluetooth earbuds working", "bose earbuds with charger", "charging case accessories", "hearing amplifier working", "jabra earbuds accessories", "skullcandy earbuds bundle", "skullcandy earbuds tested", "sony earbuds with charger", "anker earbuds with charger", "beats earbuds with charger", "beats fit pro with charger", "charging case with charger", "jabra earbuds with charger", "skullcandy earbuds working", "wireless earbuds accessories", "beats studio buds accessories", "bluetooth earbuds accessories", "hearing amplifier accessories", "wireless earbuds with charger", "beats studio buds with charger", "bluetooth earbuds with charger", "hearing amplifier with charger", "skullcandy earbuds accessories", "skullcandy earbuds with charger"],
  tablet: ["ipad", "kobo", "nook", "kindle", "tablet", "ereader", "e reader", "ipad air", "ipad kit", "ipad lot", "ipad pro", "kobo kit", "kobo lot", "nook kit", "nook lot", "ipad mini", "ipad used", "kobo used", "nook used", "galaxy tab", "ipad parts", "kindle kit", "kindle lot", "kobo parts", "nook parts", "tablet kit", "tablet lot", "ereader kit", "ereader lot", "ipad bundle", "ipad tested", "kindle fire", "kindle used", "kobo bundle", "kobo tested", "nook bundle", "nook tested", "tablet used", "e reader kit", "e reader lot", "ereader used", "ipad air kit", "ipad air lot", "ipad pro kit", "ipad pro lot", "ipad working", "kindle parts", "kobo working", "nook working", "tablet parts", "wacom tablet", "e reader used", "ereader parts", "ipad air used", "ipad mini kit", "ipad mini lot", "ipad pro used", "kindle bundle", "kindle tested", "lenovo tablet", "tablet bundle", "tablet tested", "android tablet", "drawing tablet", "e reader parts", "ereader bundle", "ereader tested", "galaxy tab kit", "galaxy tab lot", "ipad air parts", "ipad mini used", "ipad pro parts", "kindle working", "samsung tablet", "tablet working", "e reader bundle", "e reader tested", "ereader working", "galaxy tab used", "ipad air bundle", "ipad air tested", "ipad mini parts", "ipad pro bundle", "ipad pro tested", "kindle fire kit", "kindle fire lot", "e reader working", "galaxy tab parts", "ipad accessories", "ipad air working", "ipad mini bundle", "ipad mini tested", "ipad pro working", "kindle fire used", "kobo accessories", "nook accessories", "wacom tablet kit", "wacom tablet lot", "galaxy tab bundle", "galaxy tab tested", "ipad mini working", "ipad with charger", "kindle fire parts", "kobo with charger", "lenovo tablet kit", "lenovo tablet lot", "nook with charger", "remarkable tablet", "wacom tablet used", "amazon fire tablet", "android tablet kit", "android tablet lot", "drawing tablet kit", "drawing tablet lot", "galaxy tab working", "kindle accessories", "kindle fire bundle", "kindle fire tested", "lenovo tablet used", "samsung tablet kit", "samsung tablet lot", "tablet accessories", "wacom tablet parts", "android tablet used", "drawing tablet used", "ereader accessories", "kindle fire working", "kindle with charger", "lenovo tablet parts", "samsung tablet used", "tablet with charger", "wacom tablet bundle", "wacom tablet tested", "android tablet parts", "drawing tablet parts", "e reader accessories", "ereader with charger", "ipad air accessories", "ipad pro accessories", "lenovo tablet bundle", "lenovo tablet tested", "microsoft surface go", "samsung tablet parts", "wacom tablet working", "android tablet bundle", "android tablet tested", "drawing tablet bundle", "drawing tablet tested", "e reader with charger", "ipad air with charger", "ipad mini accessories", "ipad pro with charger", "lenovo tablet working", "remarkable tablet kit", "remarkable tablet lot", "samsung tablet bundle", "samsung tablet tested", "amazon fire tablet kit", "amazon fire tablet lot", "android tablet working", "drawing tablet working", "galaxy tab accessories", "ipad mini with charger", "remarkable tablet used", "samsung tablet working", "amazon fire tablet used", "galaxy tab with charger", "kindle fire accessories", "portable monitor tablet", "remarkable tablet parts", "amazon fire tablet parts", "kindle fire with charger", "microsoft surface go kit", "microsoft surface go lot", "remarkable tablet bundle", "remarkable tablet tested", "wacom tablet accessories", "amazon fire tablet bundle", "amazon fire tablet tested", "lenovo tablet accessories", "microsoft surface go used", "remarkable tablet working", "wacom tablet with charger", "amazon fire tablet working", "android tablet accessories", "drawing tablet accessories", "lenovo tablet with charger", "microsoft surface go parts", "samsung tablet accessories", "android tablet with charger", "drawing tablet with charger", "microsoft surface go bundle", "microsoft surface go tested", "portable monitor tablet kit", "portable monitor tablet lot", "samsung tablet with charger", "microsoft surface go working", "portable monitor tablet used", "portable monitor tablet parts", "remarkable tablet accessories", "amazon fire tablet accessories", "portable monitor tablet bundle", "portable monitor tablet tested", "remarkable tablet with charger", "amazon fire tablet with charger", "portable monitor tablet working", "microsoft surface go accessories", "microsoft surface go with charger", "portable monitor tablet accessories", "portable monitor tablet with charger"],
  laptop: ["laptop", "ideapad", "macbook", "asus rog", "dell xps", "thinkpad", "hp laptop", "chromebook", "hp spectre", "laptop kit", "laptop lot", "macbook m1", "macbook m2", "macbook m3", "msi laptop", "acer laptop", "asus laptop", "dell laptop", "hp pavilion", "ideapad kit", "ideapad lot", "laptop used", "lenovo yoga", "macbook air", "macbook kit", "macbook lot", "macbook pro", "msi stealth", "razer blade", "surface pro", "asus rog kit", "asus rog lot", "dell xps kit", "dell xps lot", "ideapad used", "laptop parts", "macbook used", "thinkpad kit", "thinkpad lot", "2-in-1 laptop", "acer predator", "asus rog used", "dell xps used", "gaming laptop", "hp laptop kit", "hp laptop lot", "ideapad parts", "laptop bundle", "laptop tested", "lenovo laptop", "lenovo legion", "macbook parts", "thinkpad used", "asus rog parts", "chromebook kit", "chromebook lot", "dell xps parts", "hp laptop used", "hp spectre kit", "hp spectre lot", "ideapad bundle", "ideapad tested", "laptop working", "macbook bundle", "macbook m1 kit", "macbook m1 lot", "macbook m2 kit", "macbook m2 lot", "macbook m3 kit", "macbook m3 lot", "macbook tested", "msi laptop kit", "msi laptop lot", "surface laptop", "thinkpad parts", "acer laptop kit", "acer laptop lot", "asus laptop kit", "asus laptop lot", "asus rog bundle", "asus rog tested", "chromebook used", "dell laptop kit", "dell laptop lot", "dell xps bundle", "dell xps tested", "hp laptop parts", "hp pavilion kit", "hp pavilion lot", "hp spectre used", "ideapad working", "lenovo yoga kit", "lenovo yoga lot", "macbook air kit", "macbook air lot", "macbook m1 used", "macbook m2 used", "macbook m3 used", "macbook pro kit", "macbook pro lot", "macbook working", "msi laptop used", "msi stealth kit", "msi stealth lot", "razer blade kit", "razer blade lot", "surface pro kit", "surface pro lot", "thinkpad bundle", "thinkpad tested", "acer laptop used", "alienware laptop", "asus laptop used", "asus rog working", "chromebook parts", "dell laptop used", "dell xps working", "framework laptop", "hp laptop bundle", "hp laptop tested", "hp pavilion used", "hp spectre parts", "lenovo yoga used", "macbook air used", "macbook m1 parts", "macbook m2 parts", "macbook m3 parts", "macbook pro used", "msi laptop parts", "msi stealth used", "razer blade used", "surface pro used", "thinkpad working", "2-in-1 laptop kit", "2-in-1 laptop lot", "acer laptop parts", "acer predator kit", "acer predator lot", "asus laptop parts", "chromebook bundle", "chromebook tested", "dell laptop parts", "gaming laptop kit", "gaming laptop lot", "hp laptop working", "hp pavilion parts", "hp spectre bundle", "hp spectre tested", "lenovo laptop kit", "lenovo laptop lot", "lenovo legion kit", "lenovo legion lot", "lenovo yoga parts", "macbook air parts", "macbook m1 bundle", "macbook m1 tested", "macbook m2 bundle", "macbook m2 tested", "macbook m3 bundle", "macbook m3 tested", "macbook pro parts", "msi laptop bundle", "msi laptop tested", "msi stealth parts", "notebook computer", "razer blade parts", "surface pro parts", "2-in-1 laptop used", "acer laptop bundle", "acer laptop tested", "acer predator used", "asus laptop bundle", "asus laptop tested", "chromebook working", "dell laptop bundle", "dell laptop tested", "gaming laptop used", "hp pavilion bundle", "hp pavilion tested", "hp spectre working", "laptop accessories", "lenovo laptop used", "lenovo legion used", "lenovo yoga bundle", "lenovo yoga tested", "macbook air bundle", "macbook air tested", "macbook m1 working", "macbook m2 working", "macbook m3 working", "macbook pro bundle", "macbook pro tested", "msi laptop working", "msi stealth bundle", "msi stealth tested", "razer blade bundle", "razer blade tested", "surface laptop kit", "surface laptop lot", "surface pro bundle", "surface pro tested", "2-in-1 laptop parts", "acer laptop working", "acer predator parts", "asus laptop working", "dell laptop working", "gaming laptop parts", "hp pavilion working", "ideapad accessories", "laptop with charger", "lenovo laptop parts", "lenovo legion parts", "lenovo yoga working", "macbook accessories", "macbook air working", "macbook pro working", "msi stealth working", "panasonic toughbook", "razer blade working", "surface laptop used", "surface pro working", "2-in-1 laptop bundle", "2-in-1 laptop tested", "acer predator bundle", "acer predator tested", "alienware laptop kit", "alienware laptop lot", "asus rog accessories", "dell xps accessories", "framework laptop kit", "framework laptop lot", "gaming laptop bundle", "gaming laptop tested", "ideapad with charger", "lenovo laptop bundle", "lenovo laptop tested", "lenovo legion bundle", "lenovo legion tested", "macbook with charger", "surface laptop parts", "thinkpad accessories", "2-in-1 laptop working", "acer predator working", "alienware laptop used", "asus rog with charger", "dell xps with charger", "framework laptop used", "gaming laptop working", "hp laptop accessories", "lenovo laptop working", "lenovo legion working", "notebook computer kit", "notebook computer lot", "surface laptop bundle", "surface laptop tested", "surface studio laptop", "thinkpad with charger", "alienware laptop parts", "chromebook accessories", "framework laptop parts", "hp laptop with charger", "hp spectre accessories", "macbook m1 accessories", "macbook m2 accessories", "macbook m3 accessories", "microsoft surface book", "msi laptop accessories", "notebook computer used", "surface laptop working", "acer laptop accessories", "alienware laptop bundle", "alienware laptop tested", "asus laptop accessories", "chromebook with charger", "dell laptop accessories", "framework laptop bundle", "framework laptop tested", "hp pavilion accessories", "hp spectre with charger", "lenovo yoga accessories", "macbook air accessories", "macbook m1 with charger", "macbook m2 with charger", "macbook m3 with charger", "macbook pro accessories", "msi laptop with charger", "msi stealth accessories", "notebook computer parts", "panasonic toughbook kit", "panasonic toughbook lot", "razer blade accessories", "surface pro accessories", "acer laptop with charger", "alienware laptop working", "asus laptop with charger", "dell laptop with charger", "framework laptop working", "hp pavilion with charger", "lenovo yoga with charger", "macbook air with charger", "macbook pro with charger", "msi stealth with charger", "notebook computer bundle", "notebook computer tested", "panasonic toughbook used", "razer blade with charger", "surface pro with charger", "2-in-1 laptop accessories", "acer predator accessories", "gaming laptop accessories", "lenovo laptop accessories", "lenovo legion accessories", "notebook computer working", "panasonic toughbook parts", "surface studio laptop kit", "surface studio laptop lot", "2-in-1 laptop with charger", "acer predator with charger", "gaming laptop with charger", "lenovo laptop with charger", "lenovo legion with charger", "microsoft surface book kit", "microsoft surface book lot", "panasonic toughbook bundle", "panasonic toughbook tested", "surface laptop accessories", "surface studio laptop used", "microsoft surface book used", "panasonic toughbook working", "surface laptop with charger", "surface studio laptop parts", "alienware laptop accessories", "framework laptop accessories", "microsoft surface book parts", "surface studio laptop bundle", "surface studio laptop tested", "alienware laptop with charger", "framework laptop with charger", "microsoft surface book bundle", "microsoft surface book tested", "notebook computer accessories", "surface studio laptop working", "microsoft surface book working", "notebook computer with charger", "panasonic toughbook accessories", "panasonic toughbook with charger", "surface studio laptop accessories", "microsoft surface book accessories", "surface studio laptop with charger", "microsoft surface book with charger"],
  desktopMiniPc: ["imac", "beelink", "mini pc", "imac kit", "imac lot", "mac mini", "micro pc", "imac used", "intel nuc", "imac parts", "minisforum", "beelink kit", "beelink lot", "imac bundle", "imac tested", "lenovo tiny", "mini pc kit", "mini pc lot", "thin client", "beelink used", "imac working", "mac mini kit", "mac mini lot", "micro pc kit", "micro pc lot", "mini pc used", "all in one pc", "beelink parts", "intel nuc kit", "intel nuc lot", "mac mini used", "micro pc used", "mini pc parts", "beelink bundle", "beelink tested", "intel nuc used", "mac mini parts", "micro pc parts", "mini pc bundle", "mini pc tested", "minisforum kit", "minisforum lot", "beelink working", "intel nuc parts", "lenovo tiny kit", "lenovo tiny lot", "mac mini bundle", "mac mini tested", "micro pc bundle", "micro pc tested", "mini pc working", "minisforum used", "thin client kit", "thin client lot", "desktop computer", "imac accessories", "intel nuc bundle", "intel nuc tested", "lenovo tiny used", "mac mini working", "micro pc working", "minisforum parts", "thin client used", "workstation mini", "all in one pc kit", "all in one pc lot", "hp elitedesk mini", "imac with charger", "intel nuc working", "lenovo tiny parts", "minisforum bundle", "minisforum tested", "thin client parts", "all in one pc used", "lenovo tiny bundle", "lenovo tiny tested", "minisforum working", "thin client bundle", "thin client tested", "all in one pc parts", "beelink accessories", "dell optiplex micro", "lenovo tiny working", "mini pc accessories", "thin client working", "all in one pc bundle", "all in one pc tested", "beelink with charger", "desktop computer kit", "desktop computer lot", "mac mini accessories", "micro pc accessories", "mini pc with charger", "small form factor pc", "workstation mini kit", "workstation mini lot", "all in one pc working", "desktop computer used", "hp elitedesk mini kit", "hp elitedesk mini lot", "intel nuc accessories", "mac mini with charger", "micro pc with charger", "workstation mini used", "desktop computer parts", "hp elitedesk mini used", "intel nuc with charger", "minisforum accessories", "workstation mini parts", "dell optiplex micro kit", "dell optiplex micro lot", "desktop computer bundle", "desktop computer tested", "hp elitedesk mini parts", "lenovo tiny accessories", "minisforum with charger", "thin client accessories", "workstation mini bundle", "workstation mini tested", "dell optiplex micro used", "desktop computer working", "hp elitedesk mini bundle", "hp elitedesk mini tested", "lenovo tiny with charger", "small form factor pc kit", "small form factor pc lot", "thin client with charger", "workstation mini working", "all in one pc accessories", "dell optiplex micro parts", "hp elitedesk mini working", "small form factor pc used", "all in one pc with charger", "dell optiplex micro bundle", "dell optiplex micro tested", "small form factor pc parts", "dell optiplex micro working", "small form factor pc bundle", "small form factor pc tested", "desktop computer accessories", "small form factor pc working", "workstation mini accessories", "desktop computer with charger", "hp elitedesk mini accessories", "workstation mini with charger", "hp elitedesk mini with charger", "dell optiplex micro accessories", "dell optiplex micro with charger", "small form factor pc accessories", "small form factor pc with charger"],
  gameConsole: ["nes", "ps1", "ps2", "ps3", "ps4", "ps5", "snes", "xbox", "wii u", "nes kit", "nes lot", "ps1 kit", "ps1 lot", "ps2 kit", "ps2 lot", "ps3 kit", "ps3 lot", "ps4 kit", "ps4 lot", "ps5 kit", "ps5 lot", "gamecube", "nes used", "ps1 used", "ps2 used", "ps3 used", "ps4 used", "ps5 used", "snes kit", "snes lot", "xbox 360", "xbox kit", "xbox lot", "xbox one", "dreamcast", "nes parts", "ps1 parts", "ps2 parts", "ps3 parts", "ps4 parts", "ps5 parts", "snes used", "wii u kit", "wii u lot", "xbox used", "nes bundle", "nes tested", "ps1 bundle", "ps1 tested", "ps2 bundle", "ps2 tested", "ps3 bundle", "ps3 tested", "ps4 bundle", "ps4 tested", "ps5 bundle", "ps5 tested", "snes parts", "wii u used", "xbox parts", "nes working", "nintendo 64", "playstation", "ps1 working", "ps2 working", "ps3 working", "ps4 console", "ps4 working", "ps5 console", "ps5 working", "sega saturn", "snes bundle", "snes tested", "wii console", "wii u parts", "xbox bundle", "xbox tested", "gamecube kit", "gamecube lot", "nintendo wii", "snes working", "wii u bundle", "wii u tested", "xbox 360 kit", "xbox 360 lot", "xbox console", "xbox one kit", "xbox one lot", "xbox working", "atari console", "dreamcast kit", "dreamcast lot", "gamecube used", "retro console", "wii u working", "xbox 360 used", "xbox one used", "xbox series s", "xbox series x", "dreamcast used", "gamecube parts", "gaming console", "xbox 360 parts", "xbox one parts", "dreamcast parts", "gamecube bundle", "gamecube tested", "nes accessories", "nintendo 64 kit", "nintendo 64 lot", "playstation kit", "playstation lot", "ps1 accessories", "ps2 accessories", "ps3 accessories", "ps4 accessories", "ps4 console kit", "ps4 console lot", "ps5 accessories", "ps5 console kit", "ps5 console lot", "sega saturn kit", "sega saturn lot", "wii console kit", "wii console lot", "xbox 360 bundle", "xbox 360 tested", "xbox one bundle", "xbox one tested", "dreamcast bundle", "dreamcast tested", "gamecube working", "nes with charger", "nintendo 64 used", "nintendo console", "nintendo wii kit", "nintendo wii lot", "playstation used", "ps1 with charger", "ps2 with charger", "ps3 with charger", "ps4 console used", "ps4 with charger", "ps5 console used", "ps5 with charger", "sega saturn used", "snes accessories", "wii console used", "xbox 360 working", "xbox accessories", "xbox console kit", "xbox console lot", "xbox one working", "atari console kit", "atari console lot", "dreamcast working", "nintendo 64 parts", "nintendo wii used", "playstation parts", "ps4 console parts", "ps5 console parts", "retro console kit", "retro console lot", "sega saturn parts", "snes with charger", "wii console parts", "wii u accessories", "xbox console used", "xbox series s kit", "xbox series s lot", "xbox series x kit", "xbox series x lot", "xbox with charger", "atari console used", "gaming console kit", "gaming console lot", "nintendo 64 bundle", "nintendo 64 tested", "nintendo wii parts", "playstation bundle", "playstation tested", "ps4 console bundle", "ps4 console tested", "ps5 console bundle", "ps5 console tested", "retro console used", "sega saturn bundle", "sega saturn tested", "wii console bundle", "wii console tested", "wii u with charger", "xbox console parts", "xbox series s used", "xbox series x used", "atari console parts", "gaming console used", "nintendo 64 working", "nintendo wii bundle", "nintendo wii tested", "playstation working", "ps4 console working", "ps5 console working", "retro console parts", "sega saturn working", "wii console working", "xbox console bundle", "xbox console tested", "xbox series console", "xbox series s parts", "xbox series x parts", "atari console bundle", "atari console tested", "gamecube accessories", "gaming console parts", "nintendo console kit", "nintendo console lot", "nintendo switch dock", "nintendo wii working", "retro console bundle", "retro console tested", "retro gaming console", "sega genesis console", "xbox 360 accessories", "xbox console working", "xbox one accessories", "xbox series s bundle", "xbox series s tested", "xbox series x bundle", "xbox series x tested", "atari console working", "dreamcast accessories", "gamecube with charger", "gaming console bundle", "gaming console tested", "nintendo console used", "retro console working", "xbox 360 with charger", "xbox one with charger", "xbox series s working", "xbox series x working", "dreamcast with charger", "gaming console working", "nintendo console parts", "nintendo 64 accessories", "nintendo console bundle", "nintendo console tested", "playstation accessories", "ps4 console accessories", "ps5 console accessories", "sega saturn accessories", "wii console accessories", "xbox series console kit", "xbox series console lot", "nintendo 64 with charger", "nintendo console working", "nintendo switch dock kit", "nintendo switch dock lot", "nintendo wii accessories", "playstation with charger", "ps4 console with charger", "ps5 console with charger", "retro gaming console kit", "retro gaming console lot", "sega genesis console kit", "sega genesis console lot", "sega saturn with charger", "wii console with charger", "xbox console accessories", "xbox series console used", "atari console accessories", "nintendo switch dock used", "nintendo wii with charger", "retro console accessories", "retro gaming console used", "sega genesis console used", "xbox console with charger", "xbox series console parts", "xbox series s accessories", "xbox series x accessories", "atari console with charger", "gaming console accessories", "nintendo switch dock parts", "retro console with charger", "retro gaming console parts", "sega genesis console parts", "xbox series console bundle", "xbox series console tested", "xbox series s with charger", "xbox series x with charger", "gaming console with charger", "nintendo switch dock bundle", "nintendo switch dock tested", "retro gaming console bundle", "retro gaming console tested", "sega genesis console bundle", "sega genesis console tested", "xbox series console working", "nintendo console accessories", "nintendo switch dock working", "retro gaming console working", "sega genesis console working", "nintendo console with charger", "xbox series console accessories", "nintendo switch dock accessories", "retro gaming console accessories", "sega genesis console accessories", "xbox series console with charger", "nintendo switch dock with charger", "retro gaming console with charger", "sega genesis console with charger"],
  handheldConsole: ["psp", "ayaneo", "gpd win", "ps vita", "psp kit", "psp lot", "anbernic", "game boy", "psp used", "game gear", "psp parts", "ayaneo kit", "ayaneo lot", "miyoo mini", "psp bundle", "psp tested", "steam deck", "ayaneo used", "gpd win kit", "gpd win lot", "nintendo ds", "ps vita kit", "ps vita lot", "psp working", "switch lite", "switch oled", "3ds handheld", "anbernic kit", "anbernic lot", "ayaneo parts", "game boy kit", "game boy lot", "gpd win used", "nintendo 3ds", "ps vita used", "psp handheld", "anbernic used", "asus rog ally", "ayaneo bundle", "ayaneo tested", "game boy used", "game gear kit", "game gear lot", "gpd win parts", "ps vita parts", "anbernic parts", "ayaneo working", "game boy parts", "game gear used", "gpd win bundle", "gpd win tested", "miyoo mini kit", "miyoo mini lot", "ps vita bundle", "ps vita tested", "retroid pocket", "steam deck kit", "steam deck lot", "analogue pocket", "anbernic bundle", "anbernic tested", "game boy bundle", "game boy tested", "game gear parts", "gameboy advance", "gpd win working", "miyoo mini used", "nintendo ds kit", "nintendo ds lot", "nintendo switch", "ps vita working", "psp accessories", "steam deck used", "switch lite kit", "switch lite lot", "switch oled kit", "switch oled lot", "3ds handheld kit", "3ds handheld lot", "anbernic working", "ds lite handheld", "game boy working", "game gear bundle", "game gear tested", "lenovo legion go", "miyoo mini parts", "nintendo 3ds kit", "nintendo 3ds lot", "nintendo ds used", "ps vita handheld", "psp handheld kit", "psp handheld lot", "psp with charger", "steam deck parts", "switch lite used", "switch oled used", "3ds handheld used", "asus rog ally kit", "asus rog ally lot", "game gear working", "miyoo mini bundle", "miyoo mini tested", "nintendo 3ds used", "nintendo ds parts", "psp handheld used", "rog ally handheld", "steam deck bundle", "steam deck tested", "switch lite parts", "switch oled parts", "3ds handheld parts", "asus rog ally used", "ayaneo accessories", "miyoo mini working", "nintendo 3ds parts", "nintendo ds bundle", "nintendo ds tested", "playstation portal", "psp handheld parts", "retroid pocket kit", "retroid pocket lot", "steam deck working", "switch lite bundle", "switch lite tested", "switch oled bundle", "switch oled tested", "3ds handheld bundle", "3ds handheld tested", "analogue pocket kit", "analogue pocket lot", "asus rog ally parts", "ayaneo with charger", "gameboy advance kit", "gameboy advance lot", "gpd win accessories", "nintendo 3ds bundle", "nintendo 3ds tested", "nintendo ds working", "nintendo switch kit", "nintendo switch lot", "ps vita accessories", "psp handheld bundle", "psp handheld tested", "retroid pocket used", "steam deck handheld", "switch lite working", "switch oled working", "3ds handheld working", "analogue pocket used", "anbernic accessories", "asus rog ally bundle", "asus rog ally tested", "ds lite handheld kit", "ds lite handheld lot", "game boy accessories", "gameboy advance used", "gpd win with charger", "lenovo legion go kit", "lenovo legion go lot", "nintendo 3ds working", "nintendo switch used", "ps vita handheld kit", "ps vita handheld lot", "ps vita with charger", "psp handheld working", "retroid pocket parts", "analogue pocket parts", "anbernic with charger", "asus rog ally working", "ds lite handheld used", "game boy with charger", "game gear accessories", "gameboy advance parts", "handheld game console", "lenovo legion go used", "nintendo switch parts", "ps vita handheld used", "retroid pocket bundle", "retroid pocket tested", "rog ally handheld kit", "rog ally handheld lot", "analogue pocket bundle", "analogue pocket tested", "ds lite handheld parts", "game gear with charger", "gameboy advance bundle", "gameboy advance tested", "lenovo legion go parts", "miyoo mini accessories", "nintendo switch bundle", "nintendo switch tested", "playstation portal kit", "playstation portal lot", "ps vita handheld parts", "retroid pocket working", "rog ally handheld used", "steam deck accessories", "analogue pocket working", "ds lite handheld bundle", "ds lite handheld tested", "gameboy advance working", "lenovo legion go bundle", "lenovo legion go tested", "miyoo mini with charger", "nintendo ds accessories", "nintendo switch console", "nintendo switch working", "playstation portal used", "ps vita handheld bundle", "ps vita handheld tested", "rog ally handheld parts", "steam deck handheld kit", "steam deck handheld lot", "steam deck with charger", "switch lite accessories", "switch oled accessories", "3ds handheld accessories", "ds lite handheld working", "lenovo legion go working", "nintendo 3ds accessories", "nintendo ds with charger", "playstation portal parts", "ps vita handheld working", "psp handheld accessories", "rog ally handheld bundle", "rog ally handheld tested", "steam deck handheld used", "switch lite with charger", "switch oled with charger", "3ds handheld with charger", "asus rog ally accessories", "handheld game console kit", "handheld game console lot", "nintendo 3ds with charger", "playstation portal bundle", "playstation portal tested", "psp handheld with charger", "rog ally handheld working", "steam deck handheld parts", "asus rog ally with charger", "handheld game console used", "playstation portal working", "retroid pocket accessories", "steam deck handheld bundle", "steam deck handheld tested", "analogue pocket accessories", "gameboy advance accessories", "handheld game console parts", "nintendo switch accessories", "nintendo switch console kit", "nintendo switch console lot", "retroid pocket with charger", "steam deck handheld working", "analogue pocket with charger", "ds lite handheld accessories", "gameboy advance with charger", "handheld game console bundle", "handheld game console tested", "lenovo legion go accessories", "nintendo switch console used", "nintendo switch with charger", "ps vita handheld accessories", "ds lite handheld with charger", "handheld game console working", "lenovo legion go with charger", "nintendo switch console parts", "ps vita handheld with charger", "rog ally handheld accessories", "nintendo switch console bundle", "nintendo switch console tested", "playstation portal accessories", "rog ally handheld with charger", "nintendo switch console working", "playstation portal with charger", "steam deck handheld accessories", "steam deck handheld with charger", "handheld game console accessories", "handheld game console with charger", "nintendo switch console accessories", "nintendo switch console with charger"],
  graphicsCard: ["gpu", "rtx", "egpu", "quadro", "radeon", "amd gpu", "firepro", "geforce", "gpu kit", "gpu lot", "rtx kit", "rtx lot", "egpu kit", "egpu lot", "gpu used", "rtx used", "egpu used", "gpu parts", "intel arc", "rtx parts", "egpu parts", "gpu bundle", "gpu tested", "quadro kit", "quadro lot", "radeon kit", "radeon lot", "rtx bundle", "rtx tested", "video card", "amd gpu kit", "amd gpu lot", "egpu bundle", "egpu tested", "firepro kit", "firepro lot", "geforce kit", "geforce lot", "gpu working", "nvidia card", "quadro used", "radeon used", "rtx working", "amd gpu used", "egpu working", "external gpu", "firepro used", "geforce used", "quadro parts", "radeon parts", "amd gpu parts", "firepro parts", "geforce parts", "graphics card", "intel arc kit", "intel arc lot", "quadro bundle", "quadro tested", "radeon bundle", "radeon tested", "amd gpu bundle", "amd gpu tested", "firepro bundle", "firepro tested", "geforce bundle", "geforce tested", "intel arc used", "quadro working", "radeon rx 6600", "radeon rx 6700", "radeon rx 6800", "radeon rx 6900", "radeon rx 7600", "radeon rx 7700", "radeon rx 7800", "radeon rx 7900", "radeon working", "video card kit", "video card lot", "amd gpu working", "firepro working", "geforce working", "gpu accessories", "intel arc parts", "nvidia card kit", "nvidia card lot", "nvidia rtx 3060", "nvidia rtx 3070", "nvidia rtx 3080", "nvidia rtx 3090", "nvidia rtx 4060", "nvidia rtx 4070", "nvidia rtx 4080", "nvidia rtx 4090", "rtx accessories", "video card used", "capture card gpu", "egpu accessories", "external gpu kit", "external gpu lot", "gpu with charger", "intel arc bundle", "intel arc tested", "nvidia card used", "rtx with charger", "video card parts", "egpu with charger", "external gpu used", "graphics card kit", "graphics card lot", "intel arc working", "nvidia card parts", "video card bundle", "video card tested", "external gpu parts", "graphics card used", "nvidia card bundle", "nvidia card tested", "quadro accessories", "radeon accessories", "radeon rx 6600 kit", "radeon rx 6600 lot", "radeon rx 6700 kit", "radeon rx 6700 lot", "radeon rx 6800 kit", "radeon rx 6800 lot", "radeon rx 6900 kit", "radeon rx 6900 lot", "radeon rx 7600 kit", "radeon rx 7600 lot", "radeon rx 7700 kit", "radeon rx 7700 lot", "radeon rx 7800 kit", "radeon rx 7800 lot", "radeon rx 7900 kit", "radeon rx 7900 lot", "video card working", "amd gpu accessories", "external gpu bundle", "external gpu tested", "firepro accessories", "geforce accessories", "graphics card parts", "nvidia card working", "nvidia rtx 3060 kit", "nvidia rtx 3060 lot", "nvidia rtx 3070 kit", "nvidia rtx 3070 lot", "nvidia rtx 3080 kit", "nvidia rtx 3080 lot", "nvidia rtx 3090 kit", "nvidia rtx 3090 lot", "nvidia rtx 4060 kit", "nvidia rtx 4060 lot", "nvidia rtx 4070 kit", "nvidia rtx 4070 lot", "nvidia rtx 4080 kit", "nvidia rtx 4080 lot", "nvidia rtx 4090 kit", "nvidia rtx 4090 lot", "quadro with charger", "radeon rx 6600 used", "radeon rx 6700 used", "radeon rx 6800 used", "radeon rx 6900 used", "radeon rx 7600 used", "radeon rx 7700 used", "radeon rx 7800 used", "radeon rx 7900 used", "radeon with charger", "amd gpu with charger", "capture card gpu kit", "capture card gpu lot", "external gpu working", "firepro with charger", "geforce with charger", "graphics card bundle", "graphics card tested", "nvidia rtx 3060 used", "nvidia rtx 3070 used", "nvidia rtx 3080 used", "nvidia rtx 3090 used", "nvidia rtx 4060 used", "nvidia rtx 4070 used", "nvidia rtx 4080 used", "nvidia rtx 4090 used", "radeon rx 6600 parts", "radeon rx 6700 parts", "radeon rx 6800 parts", "radeon rx 6900 parts", "radeon rx 7600 parts", "radeon rx 7700 parts", "radeon rx 7800 parts", "radeon rx 7900 parts", "capture card gpu used", "graphics card working", "intel arc accessories", "nvidia rtx 3060 parts", "nvidia rtx 3070 parts", "nvidia rtx 3080 parts", "nvidia rtx 3090 parts", "nvidia rtx 4060 parts", "nvidia rtx 4070 parts", "nvidia rtx 4080 parts", "nvidia rtx 4090 parts", "radeon rx 6600 bundle", "radeon rx 6600 tested", "radeon rx 6700 bundle", "radeon rx 6700 tested", "radeon rx 6800 bundle", "radeon rx 6800 tested", "radeon rx 6900 bundle", "radeon rx 6900 tested", "radeon rx 7600 bundle", "radeon rx 7600 tested", "radeon rx 7700 bundle", "radeon rx 7700 tested", "radeon rx 7800 bundle", "radeon rx 7800 tested", "radeon rx 7900 bundle", "radeon rx 7900 tested", "capture card gpu parts", "intel arc with charger", "nvidia rtx 3060 bundle", "nvidia rtx 3060 tested", "nvidia rtx 3070 bundle", "nvidia rtx 3070 tested", "nvidia rtx 3080 bundle", "nvidia rtx 3080 tested", "nvidia rtx 3090 bundle", "nvidia rtx 3090 tested", "nvidia rtx 4060 bundle", "nvidia rtx 4060 tested", "nvidia rtx 4070 bundle", "nvidia rtx 4070 tested", "nvidia rtx 4080 bundle", "nvidia rtx 4080 tested", "nvidia rtx 4090 bundle", "nvidia rtx 4090 tested", "pci express video card", "radeon rx 6600 working", "radeon rx 6700 working", "radeon rx 6800 working", "radeon rx 6900 working", "radeon rx 7600 working", "radeon rx 7700 working", "radeon rx 7800 working", "radeon rx 7900 working", "video card accessories", "capture card gpu bundle", "capture card gpu tested", "nvidia card accessories", "nvidia rtx 3060 working", "nvidia rtx 3070 working", "nvidia rtx 3080 working", "nvidia rtx 3090 working", "nvidia rtx 4060 working", "nvidia rtx 4070 working", "nvidia rtx 4080 working", "nvidia rtx 4090 working", "video card with charger", "capture card gpu working", "external gpu accessories", "nvidia card with charger", "external gpu with charger", "graphics card accessories", "graphics card with charger", "pci express video card kit", "pci express video card lot", "radeon rx 6600 accessories", "radeon rx 6700 accessories", "radeon rx 6800 accessories", "radeon rx 6900 accessories", "radeon rx 7600 accessories", "radeon rx 7700 accessories", "radeon rx 7800 accessories", "radeon rx 7900 accessories", "nvidia rtx 3060 accessories", "nvidia rtx 3070 accessories", "nvidia rtx 3080 accessories", "nvidia rtx 3090 accessories", "nvidia rtx 4060 accessories", "nvidia rtx 4070 accessories", "nvidia rtx 4080 accessories", "nvidia rtx 4090 accessories", "pci express video card used", "radeon rx 6600 with charger", "radeon rx 6700 with charger", "radeon rx 6800 with charger", "radeon rx 6900 with charger", "radeon rx 7600 with charger", "radeon rx 7700 with charger", "radeon rx 7800 with charger", "radeon rx 7900 with charger", "capture card gpu accessories", "nvidia rtx 3060 with charger", "nvidia rtx 3070 with charger", "nvidia rtx 3080 with charger", "nvidia rtx 3090 with charger", "nvidia rtx 4060 with charger", "nvidia rtx 4070 with charger", "nvidia rtx 4080 with charger", "nvidia rtx 4090 with charger", "pci express video card parts", "capture card gpu with charger", "pci express video card bundle", "pci express video card tested", "pci express video card working", "pci express video card accessories", "pci express video card with charger"],
  camera: ["dslr", "gopro", "camera", "webcam", "fuji xt", "nikon d", "sony a7", "dash cam", "dslr kit", "dslr lot", "insta360", "lumix gh", "camcorder", "canon eos", "dslr used", "gopro kit", "gopro lot", "camera kit", "camera lot", "dslr parts", "gopro used", "sony a6000", "sony alpha", "webcam kit", "webcam lot", "body camera", "camera used", "dslr bundle", "dslr tested", "fuji xt kit", "fuji xt lot", "gopro parts", "nikon d kit", "nikon d lot", "olympus omd", "sony a7 kit", "sony a7 lot", "webcam used", "camera parts", "canon camera", "dash cam kit", "dash cam lot", "dslr working", "fuji xt used", "gopro bundle", "gopro hero 8", "gopro hero 9", "gopro tested", "insta360 kit", "insta360 lot", "lumix gh kit", "lumix gh lot", "nikon camera", "nikon d used", "panasonic gh", "sony a7 used", "trail camera", "video camera", "webcam parts", "action camera", "backup camera", "camcorder kit", "camcorder lot", "camera bundle", "camera tested", "canon eos kit", "canon eos lot", "dash cam used", "fuji xt parts", "gopro hero 10", "gopro hero 11", "gopro hero 12", "gopro working", "insta360 used", "lumix gh used", "nikon d parts", "sony a7 parts", "webcam bundle", "webcam tested", "camcorder used", "camera working", "canon eos used", "dash cam parts", "digital camera", "fuji xt bundle", "fuji xt tested", "insta360 parts", "lumix gh parts", "nikon d bundle", "nikon d tested", "olympus camera", "sony a6000 kit", "sony a6000 lot", "sony a7 bundle", "sony a7 tested", "sony alpha kit", "sony alpha lot", "webcam working", "body camera kit", "body camera lot", "camcorder parts", "canon eos parts", "dash cam bundle", "dash cam tested", "doorbell camera", "fuji xt working", "fujifilm camera", "insta360 bundle", "insta360 tested", "lumix gh bundle", "lumix gh tested", "nikon d working", "olympus omd kit", "olympus omd lot", "panasonic lumix", "security camera", "sony a6000 used", "sony a7 working", "sony alpha used", "body camera used", "camcorder bundle", "camcorder tested", "canon camera kit", "canon camera lot", "canon eos bundle", "canon eos tested", "dash cam working", "dslr accessories", "gopro hero 8 kit", "gopro hero 8 lot", "gopro hero 9 kit", "gopro hero 9 lot", "insta360 working", "lumix gh working", "nikon camera kit", "nikon camera lot", "olympus omd used", "panasonic gh kit", "panasonic gh lot", "sony a6000 parts", "sony alpha parts", "trail camera kit", "trail camera lot", "video camera kit", "video camera lot", "action camera kit", "action camera lot", "backup camera kit", "backup camera lot", "body camera parts", "camcorder working", "canon camera used", "canon eos working", "dslr with charger", "gopro accessories", "gopro hero 10 kit", "gopro hero 10 lot", "gopro hero 11 kit", "gopro hero 11 lot", "gopro hero 12 kit", "gopro hero 12 lot", "gopro hero 8 used", "gopro hero 9 used", "mirrorless camera", "nikon camera used", "olympus omd parts", "panasonic gh used", "sony a6000 bundle", "sony a6000 tested", "sony alpha bundle", "sony alpha tested", "trail camera used", "video camera used", "action camera used", "backup camera used", "body camera bundle", "body camera tested", "camera accessories", "canon camera parts", "digital camera kit", "digital camera lot", "gopro hero 10 used", "gopro hero 11 used", "gopro hero 12 used", "gopro hero 8 parts", "gopro hero 9 parts", "gopro with charger", "nikon camera parts", "olympus camera kit", "olympus camera lot", "olympus omd bundle", "olympus omd tested", "panasonic gh parts", "sony a6000 working", "sony alpha working", "trail camera parts", "video camera parts", "webcam accessories", "action camera parts", "backup camera parts", "body camera working", "camera with charger", "canon camera bundle", "canon camera tested", "digital camera used", "doorbell camera kit", "doorbell camera lot", "fuji xt accessories", "fujifilm camera kit", "fujifilm camera lot", "gopro hero 10 parts", "gopro hero 11 parts", "gopro hero 12 parts", "gopro hero 8 bundle", "gopro hero 8 tested", "gopro hero 9 bundle", "gopro hero 9 tested", "nikon camera bundle", "nikon camera tested", "nikon d accessories", "olympus camera used", "olympus omd working", "panasonic gh bundle", "panasonic gh tested", "panasonic lumix kit", "panasonic lumix lot", "security camera kit", "security camera lot", "sony a7 accessories", "trail camera bundle", "trail camera tested", "video camera bundle", "video camera tested", "webcam with charger", "action camera bundle", "action camera tested", "backup camera bundle", "backup camera tested", "canon camera working", "dash cam accessories", "digital camera parts", "doorbell camera used", "fuji xt with charger", "fujifilm camera used", "gopro hero 10 bundle", "gopro hero 10 tested", "gopro hero 11 bundle", "gopro hero 11 tested", "gopro hero 12 bundle", "gopro hero 12 tested", "gopro hero 8 working", "gopro hero 9 working", "insta360 accessories", "lumix gh accessories", "nikon camera working", "nikon d with charger", "olympus camera parts", "panasonic gh working", "panasonic lumix used", "security camera used", "sony a7 with charger", "trail camera working", "video camera working", "action camera working", "backup camera working", "camcorder accessories", "canon eos accessories", "dash cam with charger", "digital camera bundle", "digital camera tested", "doorbell camera parts", "fujifilm camera parts", "gopro hero 10 working", "gopro hero 11 working", "gopro hero 12 working", "insta360 with charger", "lumix gh with charger", "mirrorless camera kit", "mirrorless camera lot", "olympus camera bundle", "olympus camera tested", "panasonic lumix parts", "security camera parts", "camcorder with charger", "canon eos with charger", "digital camera working", "doorbell camera bundle", "doorbell camera tested", "fujifilm camera bundle", "fujifilm camera tested", "mirrorless camera used", "olympus camera working", "panasonic lumix bundle", "panasonic lumix tested", "point and shoot camera", "security camera bundle", "security camera tested", "sony a6000 accessories", "sony alpha accessories", "body camera accessories", "doorbell camera working", "fujifilm camera working", "mirrorless camera parts", "olympus omd accessories", "panasonic lumix working", "security camera working", "sony a6000 with charger", "sony alpha with charger", "body camera with charger", "canon camera accessories", "gopro hero 8 accessories", "gopro hero 9 accessories", "mirrorless camera bundle", "mirrorless camera tested", "nikon camera accessories", "olympus omd with charger", "panasonic gh accessories", "trail camera accessories", "video camera accessories", "action camera accessories", "backup camera accessories", "canon camera with charger", "gopro hero 10 accessories", "gopro hero 11 accessories", "gopro hero 12 accessories", "gopro hero 8 with charger", "gopro hero 9 with charger", "mirrorless camera working", "nikon camera with charger", "panasonic gh with charger", "trail camera with charger", "video camera with charger", "action camera with charger", "backup camera with charger", "digital camera accessories", "gopro hero 10 with charger", "gopro hero 11 with charger", "gopro hero 12 with charger", "olympus camera accessories", "point and shoot camera kit", "point and shoot camera lot", "digital camera with charger", "doorbell camera accessories", "fujifilm camera accessories", "olympus camera with charger", "panasonic lumix accessories", "point and shoot camera used", "security camera accessories", "doorbell camera with charger", "fujifilm camera with charger", "panasonic lumix with charger", "point and shoot camera parts", "security camera with charger", "mirrorless camera accessories", "point and shoot camera bundle", "point and shoot camera tested", "mirrorless camera with charger", "point and shoot camera working", "point and shoot camera accessories", "point and shoot camera with charger"],
  cameraLens: ["lens kit", "35mm lens", "50mm lens", "85mm lens", "sony lens", "zoom lens", "canon lens", "macro lens", "nikon lens", "prime lens", "sigma lens", "camera lens", "tamron lens", "fisheye lens", "lens kit kit", "lens kit lot", "35mm lens kit", "35mm lens lot", "50mm lens kit", "50mm lens lot", "85mm lens kit", "85mm lens lot", "fujifilm lens", "lens kit used", "sony lens kit", "sony lens lot", "zoom lens kit", "zoom lens lot", "35mm lens used", "50mm lens used", "85mm lens used", "canon lens kit", "canon lens lot", "lens kit parts", "macro lens kit", "macro lens lot", "nikon lens kit", "nikon lens lot", "prime lens kit", "prime lens lot", "sigma lens kit", "sigma lens lot", "sony lens used", "telephoto lens", "zoom lens used", "35mm lens parts", "50mm lens parts", "85mm lens parts", "camera lens kit", "camera lens lot", "canon lens used", "lens filter kit", "lens kit bundle", "lens kit tested", "macro lens used", "nikon lens used", "prime lens used", "sigma lens used", "sony lens parts", "tamron lens kit", "tamron lens lot", "wide angle lens", "zoom lens parts", "35mm lens bundle", "35mm lens tested", "50mm lens bundle", "50mm lens tested", "85mm lens bundle", "85mm lens tested", "camera lens used", "canon lens parts", "fisheye lens kit", "fisheye lens lot", "lens kit working", "macro lens parts", "nikon lens parts", "prime lens parts", "sigma lens parts", "sony lens bundle", "sony lens tested", "tamron lens used", "zoom lens bundle", "zoom lens tested", "35mm lens working", "50mm lens working", "85mm lens working", "camera lens parts", "canon lens bundle", "canon lens tested", "fisheye lens used", "fujifilm lens kit", "fujifilm lens lot", "macro lens bundle", "macro lens tested", "nikon lens bundle", "nikon lens tested", "prime lens bundle", "prime lens tested", "sigma lens bundle", "sigma lens tested", "sony lens working", "tamron lens parts", "zoom lens working", "camera lens bundle", "camera lens tested", "canon lens working", "fisheye lens parts", "fujifilm lens used", "macro lens working", "nikon lens working", "prime lens working", "sigma lens working", "tamron lens bundle", "tamron lens tested", "telephoto lens kit", "telephoto lens lot", "camera lens working", "fisheye lens bundle", "fisheye lens tested", "fujifilm lens parts", "lens filter kit kit", "lens filter kit lot", "tamron lens working", "telephoto lens used", "wide angle lens kit", "wide angle lens lot", "fisheye lens working", "fujifilm lens bundle", "fujifilm lens tested", "lens filter kit used", "lens kit accessories", "telephoto lens parts", "wide angle lens used", "35mm lens accessories", "50mm lens accessories", "85mm lens accessories", "fujifilm lens working", "lens filter kit parts", "lens kit with charger", "sony lens accessories", "telephoto lens bundle", "telephoto lens tested", "wide angle lens parts", "zoom lens accessories", "35mm lens with charger", "50mm lens with charger", "85mm lens with charger", "canon lens accessories", "lens filter kit bundle", "lens filter kit tested", "macro lens accessories", "nikon lens accessories", "prime lens accessories", "sigma lens accessories", "sony lens with charger", "telephoto lens working", "wide angle lens bundle", "wide angle lens tested", "zoom lens with charger", "camera lens accessories", "canon lens with charger", "lens filter kit working", "macro lens with charger", "nikon lens with charger", "prime lens with charger", "sigma lens with charger", "tamron lens accessories", "wide angle lens working", "camera lens with charger", "fisheye lens accessories", "tamron lens with charger", "fisheye lens with charger", "fujifilm lens accessories", "fujifilm lens with charger", "telephoto lens accessories", "lens filter kit accessories", "telephoto lens with charger", "wide angle lens accessories", "lens filter kit with charger", "wide angle lens with charger"],
  networkDevice: ["nas", "qnap", "modem", "unifi", "router", "nas kit", "nas lot", "netgate", "firewall", "fortinet", "mikrotik", "nas used", "qnap kit", "qnap lot", "synology", "ubiquiti", "dsl modem", "eero mesh", "modem kit", "modem lot", "nas parts", "orbi mesh", "qnap used", "sonicwall", "unifi kit", "unifi lot", "modem used", "nas bundle", "nas tested", "poe switch", "qnap parts", "router kit", "router lot", "sfp module", "unifi used", "arris modem", "asus router", "cable modem", "mesh router", "modem parts", "nas working", "netgate kit", "netgate lot", "patch panel", "qnap bundle", "qnap tested", "router used", "transceiver", "unifi parts", "wifi router", "access point", "aruba switch", "cisco meraki", "cisco switch", "firewall kit", "firewall lot", "fortinet kit", "fortinet lot", "mikrotik kit", "mikrotik lot", "modem bundle", "modem tested", "netgate used", "qnap working", "router parts", "synology kit", "synology lot", "ubiquiti kit", "ubiquiti lot", "unifi bundle", "unifi tested", "dsl modem kit", "dsl modem lot", "eero mesh kit", "eero mesh lot", "firewall used", "fortinet used", "linksys velop", "load balancer", "mikrotik used", "modem working", "netgate parts", "orbi mesh kit", "orbi mesh lot", "router bundle", "router tested", "sonicwall kit", "sonicwall lot", "synology used", "ubiquiti used", "unifi working", "dsl modem used", "eero mesh used", "firewall parts", "fortinet parts", "juniper switch", "mikrotik parts", "motorola modem", "netgate bundle", "netgate tested", "network switch", "orbi mesh used", "poe switch kit", "poe switch lot", "router working", "sfp module kit", "sfp module lot", "sonicwall used", "synology parts", "tp link router", "ubiquiti parts", "arris modem kit", "arris modem lot", "asus router kit", "asus router lot", "cable modem kit", "cable modem lot", "dsl modem parts", "eero mesh parts", "ethernet switch", "firewall bundle", "firewall tested", "fortinet bundle", "fortinet tested", "mesh router kit", "mesh router lot", "mikrotik bundle", "mikrotik tested", "nas accessories", "netgate working", "network adapter", "orbi mesh parts", "patch panel kit", "patch panel lot", "poe switch used", "sfp module used", "sonicwall parts", "synology bundle", "synology tested", "transceiver kit", "transceiver lot", "ubiquiti bundle", "ubiquiti tested", "unifi cloud key", "wifi router kit", "wifi router lot", "access point kit", "access point lot", "arris modem used", "aruba switch kit", "aruba switch lot", "asus router used", "cable modem used", "cisco meraki kit", "cisco meraki lot", "cisco switch kit", "cisco switch lot", "dsl modem bundle", "dsl modem tested", "eero mesh bundle", "eero mesh tested", "firewall working", "fortinet working", "mesh router used", "mikrotik working", "nas with charger", "orbi mesh bundle", "orbi mesh tested", "patch panel used", "poe switch parts", "qnap accessories", "sfp module parts", "sonicwall bundle", "sonicwall tested", "synology working", "transceiver used", "ubiquiti working", "wifi router used", "access point used", "arris modem parts", "aruba switch used", "asus router parts", "cable modem parts", "cisco meraki used", "cisco switch used", "dsl modem working", "eero mesh working", "linksys velop kit", "linksys velop lot", "load balancer kit", "load balancer lot", "mesh router parts", "modem accessories", "netgear nighthawk", "orbi mesh working", "patch panel parts", "poe switch bundle", "poe switch tested", "qnap with charger", "sfp module bundle", "sfp module tested", "sonicwall working", "transceiver parts", "unifi accessories", "wifi router parts", "access point parts", "arris modem bundle", "arris modem tested", "aruba switch parts", "asus router bundle", "asus router tested", "cable modem bundle", "cable modem tested", "cisco meraki parts", "cisco switch parts", "juniper switch kit", "juniper switch lot", "linksys velop used", "load balancer used", "mesh router bundle", "mesh router tested", "modem with charger", "motorola modem kit", "motorola modem lot", "network switch kit", "network switch lot", "palo alto firewall", "patch panel bundle", "patch panel tested", "poe switch working", "router accessories", "sfp module working", "tp link router kit", "tp link router lot", "transceiver bundle", "transceiver tested", "unifi with charger", "wifi router bundle", "wifi router tested", "access point bundle", "access point tested", "arris modem working", "aruba switch bundle", "aruba switch tested", "asus router working", "cable modem working", "cisco meraki bundle", "cisco meraki tested", "cisco switch bundle", "cisco switch tested", "ethernet switch kit", "ethernet switch lot", "juniper switch used", "linksys velop parts", "load balancer parts", "mesh router working", "motorola modem used", "netgate accessories", "network adapter kit", "network adapter lot", "network switch used", "patch panel working", "router with charger", "tp link router used", "transceiver working", "unifi cloud key kit", "unifi cloud key lot", "unifi dream machine", "wifi router working", "access point working", "aruba switch working", "cisco meraki working", "cisco switch working", "ethernet switch used", "firewall accessories", "fortinet accessories", "juniper switch parts", "linksys velop bundle", "linksys velop tested", "load balancer bundle", "load balancer tested", "mikrotik accessories", "motorola modem parts", "netgate with charger", "network adapter used", "network switch parts", "synology accessories", "tp link router parts", "ubiquiti accessories", "unifi cloud key used", "dsl modem accessories", "eero mesh accessories", "ethernet switch parts", "firewall with charger", "fortinet with charger", "juniper switch bundle", "juniper switch tested", "linksys velop working", "load balancer working", "mikrotik with charger", "motorola modem bundle", "motorola modem tested", "netgear nighthawk kit", "netgear nighthawk lot", "network adapter parts", "network switch bundle", "network switch tested", "orbi mesh accessories", "sonicwall accessories", "synology with charger", "tp link router bundle", "tp link router tested", "ubiquiti with charger", "unifi cloud key parts", "wireless access point", "dsl modem with charger", "eero mesh with charger", "ethernet switch bundle", "ethernet switch tested", "juniper switch working", "motorola modem working", "netgear nighthawk used", "network adapter bundle", "network adapter tested", "network switch working", "orbi mesh with charger", "palo alto firewall kit", "palo alto firewall lot", "poe switch accessories", "sfp module accessories", "sonicwall with charger", "tp link router working", "unifi cloud key bundle", "unifi cloud key tested", "arris modem accessories", "asus router accessories", "cable modem accessories", "ethernet switch working", "mesh router accessories", "netgear nighthawk parts", "network adapter working", "palo alto firewall used", "patch panel accessories", "poe switch with charger", "sfp module with charger", "transceiver accessories", "unifi cloud key working", "unifi dream machine kit", "unifi dream machine lot", "wifi router accessories", "access point accessories", "arris modem with charger", "aruba switch accessories", "asus router with charger", "cable modem with charger", "cisco meraki accessories", "cisco switch accessories", "mesh router with charger", "netgear nighthawk bundle", "netgear nighthawk tested", "palo alto firewall parts", "patch panel with charger", "transceiver with charger", "unifi dream machine used", "wifi router with charger", "access point with charger", "aruba switch with charger", "cisco meraki with charger", "cisco switch with charger", "linksys velop accessories", "load balancer accessories", "netgear nighthawk working", "palo alto firewall bundle", "palo alto firewall tested", "unifi dream machine parts", "wireless access point kit", "wireless access point lot", "juniper switch accessories", "linksys velop with charger", "load balancer with charger", "motorola modem accessories", "network switch accessories", "palo alto firewall working", "tp link router accessories", "unifi dream machine bundle", "unifi dream machine tested", "wireless access point used", "ethernet switch accessories", "juniper switch with charger", "motorola modem with charger", "network adapter accessories", "network switch with charger", "tp link router with charger", "unifi cloud key accessories", "unifi dream machine working", "wireless access point parts", "ethernet switch with charger", "network adapter with charger", "unifi cloud key with charger", "wireless access point bundle", "wireless access point tested", "netgear nighthawk accessories", "wireless access point working", "netgear nighthawk with charger", "palo alto firewall accessories", "palo alto firewall with charger", "unifi dream machine accessories", "unifi dream machine with charger", "wireless access point accessories", "wireless access point with charger"],
  smallElectronics: ["gps", "ssd", "ipod", "roku", "airtag", "fitbit", "garmin", "gps kit", "gps lot", "ssd kit", "ssd lot", "usb hub", "gps used", "ipod kit", "ipod lot", "roku kit", "roku lot", "ssd used", "gps parts", "ipod used", "roku used", "ssd parts", "tv remote", "airtag kit", "airtag lot", "calculator", "chromecast", "fitbit kit", "fitbit lot", "garmin kit", "garmin lot", "gps bundle", "gps tested", "hard drive", "ipod parts", "mp3 player", "power bank", "ram memory", "roku parts", "ssd bundle", "ssd tested", "thermostat", "airtag used", "apple watch", "fitbit used", "garmin used", "gps working", "ipod bundle", "ipod tested", "label maker", "memory card", "roku bundle", "roku tested", "smart watch", "ssd working", "usb hub kit", "usb hub lot", "airtag parts", "fitbit parts", "galaxy watch", "garmin parts", "ipod working", "roku working", "tile tracker", "usb hub used", "airtag bundle", "airtag tested", "cpu processor", "fire tv stick", "fitbit bundle", "fitbit tested", "garmin bundle", "garmin tested", "ring doorbell", "tv remote kit", "tv remote lot", "usb hub parts", "airtag working", "calculator kit", "calculator lot", "chromecast kit", "chromecast lot", "fitbit working", "garmin working", "hard drive kit", "hard drive lot", "mp3 player kit", "mp3 player lot", "power bank kit", "power bank lot", "ram memory kit", "ram memory lot", "remote control", "thermostat kit", "thermostat lot", "tv remote used", "usb hub bundle", "usb hub tested", "video doorbell", "voice recorder", "apple watch kit", "apple watch lot", "calculator used", "chromecast used", "docking station", "fitness tracker", "gps accessories", "hard drive used", "label maker kit", "label maker lot", "memory card kit", "memory card lot", "mp3 player used", "power bank used", "ram memory used", "smart watch kit", "smart watch lot", "ssd accessories", "streaming stick", "thermostat used", "tv remote parts", "usb hub working", "apple watch used", "calculator parts", "chromecast parts", "galaxy watch kit", "galaxy watch lot", "gps with charger", "hard drive parts", "ipod accessories", "label maker used", "memory card used", "mp3 player parts", "portable charger", "power bank parts", "ram memory parts", "roku accessories", "smart thermostat", "smart watch used", "ssd with charger", "thermostat parts", "tile tracker kit", "tile tracker lot", "tv remote bundle", "tv remote tested", "apple watch parts", "bluetooth speaker", "calculator bundle", "calculator tested", "chromecast bundle", "chromecast tested", "cpu processor kit", "cpu processor lot", "fire tv stick kit", "fire tv stick lot", "galaxy watch used", "hard drive bundle", "hard drive tested", "ipod with charger", "label maker parts", "memory card parts", "motherboard small", "mp3 player bundle", "mp3 player tested", "power bank bundle", "power bank tested", "ram memory bundle", "ram memory tested", "ring doorbell kit", "ring doorbell lot", "roku with charger", "smart watch parts", "thermostat bundle", "thermostat tested", "tile tracker used", "tv remote working", "airtag accessories", "apple watch bundle", "apple watch tested", "calculator working", "chromecast working", "cpu processor used", "fire tv stick used", "fitbit accessories", "galaxy watch parts", "garmin accessories", "hard drive working", "label maker bundle", "label maker tested", "memory card bundle", "memory card tested", "mp3 player working", "power bank working", "ram memory working", "remote control kit", "remote control lot", "ring doorbell used", "smart watch bundle", "smart watch tested", "thermostat working", "tile tracker parts", "video doorbell kit", "video doorbell lot", "voice recorder kit", "voice recorder lot", "airtag with charger", "apple watch working", "cpu processor parts", "digital photo frame", "docking station kit", "docking station lot", "external hard drive", "fire tv stick parts", "fitbit with charger", "fitness tracker kit", "fitness tracker lot", "galaxy watch bundle", "galaxy watch tested", "garmin with charger", "graphing calculator", "label maker working", "memory card working", "presentation remote", "remote control used", "ring doorbell parts", "smart watch working", "streaming stick kit", "streaming stick lot", "tile tracker bundle", "tile tracker tested", "usb hub accessories", "video doorbell used", "voice recorder used", "cpu processor bundle", "cpu processor tested", "docking station used", "fire tv stick bundle", "fire tv stick tested", "fitness tracker used", "galaxy watch working", "portable charger kit", "portable charger lot", "remote control parts", "ring doorbell bundle", "ring doorbell tested", "smart thermostat kit", "smart thermostat lot", "streaming stick used", "tile tracker working", "usb hub with charger", "video doorbell parts", "voice recorder parts", "bluetooth speaker kit", "bluetooth speaker lot", "cpu processor working", "docking station parts", "fire tv stick working", "fitness tracker parts", "motherboard small kit", "motherboard small lot", "portable charger used", "remote control bundle", "remote control tested", "ring doorbell working", "smart thermostat used", "streaming stick parts", "tv remote accessories", "video doorbell bundle", "video doorbell tested", "voice recorder bundle", "voice recorder tested", "bluetooth speaker used", "calculator accessories", "chromecast accessories", "docking station bundle", "docking station tested", "fitness tracker bundle", "fitness tracker tested", "hard drive accessories", "motherboard small used", "mp3 player accessories", "portable charger parts", "power bank accessories", "ram memory accessories", "remote control working", "smart thermostat parts", "streaming stick bundle", "streaming stick tested", "thermostat accessories", "tv remote with charger", "video doorbell working", "voice recorder working", "apple watch accessories", "bluetooth speaker parts", "calculator with charger", "chromecast with charger", "digital photo frame kit", "digital photo frame lot", "docking station working", "external hard drive kit", "external hard drive lot", "fitness tracker working", "graphing calculator kit", "graphing calculator lot", "hard drive with charger", "label maker accessories", "memory card accessories", "motherboard small parts", "mp3 player with charger", "portable charger bundle", "portable charger tested", "power bank with charger", "presentation remote kit", "presentation remote lot", "ram memory with charger", "smart thermostat bundle", "smart thermostat tested", "smart watch accessories", "streaming stick working", "thermostat with charger", "apple watch with charger", "bluetooth speaker bundle", "bluetooth speaker tested", "digital photo frame used", "external hard drive used", "galaxy watch accessories", "graphing calculator used", "label maker with charger", "memory card with charger", "motherboard small bundle", "motherboard small tested", "portable charger working", "presentation remote used", "smart thermostat working", "smart watch with charger", "tile tracker accessories", "bluetooth speaker working", "cpu processor accessories", "digital photo frame parts", "external hard drive parts", "fire tv stick accessories", "galaxy watch with charger", "graphing calculator parts", "motherboard small working", "presentation remote parts", "ring doorbell accessories", "tile tracker with charger", "cpu processor with charger", "digital photo frame bundle", "digital photo frame tested", "external hard drive bundle", "external hard drive tested", "fire tv stick with charger", "graphing calculator bundle", "graphing calculator tested", "presentation remote bundle", "presentation remote tested", "remote control accessories", "ring doorbell with charger", "video doorbell accessories", "voice recorder accessories", "digital photo frame working", "docking station accessories", "external hard drive working", "fitness tracker accessories", "graphing calculator working", "presentation remote working", "remote control with charger", "streaming stick accessories", "video doorbell with charger", "voice recorder with charger", "docking station with charger", "fitness tracker with charger", "portable charger accessories", "smart thermostat accessories", "streaming stick with charger", "bluetooth speaker accessories", "motherboard small accessories", "portable charger with charger", "smart thermostat with charger", "bluetooth speaker with charger", "motherboard small with charger", "digital photo frame accessories", "external hard drive accessories", "graphing calculator accessories", "presentation remote accessories", "digital photo frame with charger", "external hard drive with charger", "graphing calculator with charger", "presentation remote with charger"],
  mediumElectronics: ["vcr", "oculus", "printer", "scanner", "vcr kit", "vcr lot", "receiver", "soundbar", "vcr used", "projector", "vcr parts", "car stereo", "dvd player", "meta quest", "oculus kit", "oculus lot", "vcr bundle", "vcr tested", "vr headset", "audio mixer", "oculus used", "printer kit", "printer lot", "scanner kit", "scanner lot", "vcr working", "oculus parts", "printer used", "receiver kit", "receiver lot", "scanner used", "soundbar kit", "soundbar lot", "cassette deck", "label printer", "oculus bundle", "oculus tested", "printer parts", "projector kit", "projector lot", "receiver used", "scanner parts", "soundbar used", "blu ray player", "car stereo kit", "car stereo lot", "dvd player kit", "dvd player lot", "meta quest kit", "meta quest lot", "microphone kit", "oculus working", "playstation vr", "printer bundle", "printer tested", "projector used", "receiver parts", "scanner bundle", "scanner tested", "soundbar parts", "vr headset kit", "vr headset lot", "audio mixer kit", "audio mixer lot", "barcode scanner", "car stereo used", "dvd player used", "gaming keyboard", "meta quest used", "printer working", "projector parts", "receiver bundle", "receiver tested", "scanner working", "soundbar bundle", "soundbar tested", "tablet keyboard", "thermal printer", "turntable small", "vcr accessories", "vr headset used", "audio mixer used", "car stereo parts", "document scanner", "drone controller", "dvd player parts", "meta quest parts", "projector bundle", "projector tested", "receiver working", "soundbar working", "vcr with charger", "vr headset parts", "audio mixer parts", "car stereo bundle", "car stereo tested", "cassette deck kit", "cassette deck lot", "dvd player bundle", "dvd player tested", "label printer kit", "label printer lot", "meta quest bundle", "meta quest tested", "projector working", "studio microphone", "vr headset bundle", "vr headset tested", "audio mixer bundle", "audio mixer tested", "blu ray player kit", "blu ray player lot", "car stereo working", "cassette deck used", "dvd player working", "label printer used", "meta quest working", "microphone kit kit", "microphone kit lot", "oculus accessories", "playstation vr kit", "playstation vr lot", "portable projector", "vr headset working", "audio mixer working", "barcode scanner kit", "barcode scanner lot", "blu ray player used", "cassette deck parts", "gaming keyboard kit", "gaming keyboard lot", "label printer parts", "mechanical keyboard", "microphone kit used", "oculus with charger", "playstation vr used", "printer accessories", "scanner accessories", "tablet keyboard kit", "tablet keyboard lot", "thermal printer kit", "thermal printer lot", "turntable small kit", "turntable small lot", "barcode scanner used", "blu ray player parts", "cassette deck bundle", "cassette deck tested", "document scanner kit", "document scanner lot", "drone controller kit", "drone controller lot", "gaming keyboard used", "label printer bundle", "label printer tested", "microphone kit parts", "playstation vr parts", "printer with charger", "receiver accessories", "scanner with charger", "soundbar accessories", "tablet keyboard used", "thermal printer used", "turntable small used", "barcode scanner parts", "blu ray player bundle", "blu ray player tested", "cassette deck working", "document scanner used", "drone controller used", "gaming keyboard parts", "label printer working", "microphone kit bundle", "microphone kit tested", "midi controller small", "playstation vr bundle", "playstation vr tested", "projector accessories", "receiver with charger", "soundbar with charger", "studio microphone kit", "studio microphone lot", "tablet keyboard parts", "thermal printer parts", "turntable small parts", "barcode scanner bundle", "barcode scanner tested", "blu ray player working", "car stereo accessories", "computer monitor small", "document scanner parts", "drone controller parts", "dvd player accessories", "gaming keyboard bundle", "gaming keyboard tested", "meta quest accessories", "microphone kit working", "playstation vr working", "portable projector kit", "portable projector lot", "projector with charger", "studio microphone used", "tablet keyboard bundle", "tablet keyboard tested", "thermal printer bundle", "thermal printer tested", "turntable small bundle", "turntable small tested", "vr headset accessories", "audio mixer accessories", "barcode scanner working", "car stereo with charger", "document scanner bundle", "document scanner tested", "drone controller bundle", "drone controller tested", "dvd player with charger", "gaming keyboard working", "mechanical keyboard kit", "mechanical keyboard lot", "meta quest with charger", "portable projector used", "studio microphone parts", "tablet keyboard working", "thermal printer working", "turntable small working", "vr headset with charger", "audio mixer with charger", "document scanner working", "drone controller working", "mechanical keyboard used", "portable projector parts", "studio microphone bundle", "studio microphone tested", "cassette deck accessories", "label printer accessories", "mechanical keyboard parts", "midi controller small kit", "midi controller small lot", "portable projector bundle", "portable projector tested", "studio microphone working", "blu ray player accessories", "cassette deck with charger", "computer monitor small kit", "computer monitor small lot", "label printer with charger", "mechanical keyboard bundle", "mechanical keyboard tested", "microphone kit accessories", "midi controller small used", "playstation vr accessories", "portable projector working", "barcode scanner accessories", "blu ray player with charger", "computer monitor small used", "gaming keyboard accessories", "mechanical keyboard working", "microphone kit with charger", "midi controller small parts", "playstation vr with charger", "tablet keyboard accessories", "thermal printer accessories", "turntable small accessories", "barcode scanner with charger", "computer monitor small parts", "document scanner accessories", "drone controller accessories", "gaming keyboard with charger", "midi controller small bundle", "midi controller small tested", "tablet keyboard with charger", "thermal printer with charger", "turntable small with charger", "computer monitor small bundle", "computer monitor small tested", "document scanner with charger", "drone controller with charger", "midi controller small working", "studio microphone accessories", "computer monitor small working", "portable projector accessories", "studio microphone with charger", "mechanical keyboard accessories", "portable projector with charger", "mechanical keyboard with charger", "midi controller small accessories", "computer monitor small accessories", "midi controller small with charger", "computer monitor small with charger"],
  largeElectronics: ["monitor", "pc case", "tv small", "amplifier", "subwoofer", "television", "av receiver", "large mixer", "monitor kit", "monitor lot", "pc case kit", "pc case lot", "home theater", "monitor used", "pc case used", "speaker pair", "tv small kit", "tv small lot", "amplifier kit", "amplifier lot", "desktop tower", "dj controller", "large printer", "laser printer", "monitor parts", "pc case parts", "power station", "subwoofer kit", "subwoofer lot", "tv small used", "amplifier used", "gaming monitor", "monitor bundle", "monitor tested", "pc case bundle", "pc case tested", "subwoofer used", "television kit", "television lot", "tv small parts", "amplifier parts", "av receiver kit", "av receiver lot", "large mixer kit", "large mixer lot", "monitor working", "pc case working", "solar generator", "stereo receiver", "subwoofer parts", "television used", "tv small bundle", "tv small tested", "amplifier bundle", "amplifier tested", "av receiver used", "computer monitor", "home theater kit", "home theater lot", "large mixer used", "speaker pair kit", "speaker pair lot", "subwoofer bundle", "subwoofer tested", "television parts", "tv small working", "amplifier working", "av receiver parts", "desktop tower kit", "desktop tower lot", "dj controller kit", "dj controller lot", "home theater used", "large mixer parts", "large printer kit", "large printer lot", "laser printer kit", "laser printer lot", "power station kit", "power station lot", "speaker pair used", "subwoofer working", "television bundle", "television tested", "av receiver bundle", "av receiver tested", "desktop tower used", "dj controller used", "gaming monitor kit", "gaming monitor lot", "home theater parts", "large mixer bundle", "large mixer tested", "large printer used", "laser printer used", "power station used", "speaker pair parts", "television working", "ups battery backup", "av receiver working", "desktop tower parts", "dj controller parts", "gaming monitor used", "home theater bundle", "home theater tested", "large mixer working", "large printer parts", "laser printer parts", "monitor accessories", "pc case accessories", "power station parts", "solar generator kit", "solar generator lot", "speaker pair bundle", "speaker pair tested", "stereo receiver kit", "stereo receiver lot", "computer monitor kit", "computer monitor lot", "desktop tower bundle", "desktop tower tested", "dj controller bundle", "dj controller tested", "gaming monitor parts", "home theater working", "large printer bundle", "large printer tested", "laser printer bundle", "laser printer tested", "monitor with charger", "pc case with charger", "power station bundle", "power station tested", "solar generator used", "speaker pair working", "stereo receiver used", "tv small accessories", "amplifier accessories", "computer monitor used", "desktop tower working", "dj controller working", "gaming monitor bundle", "gaming monitor tested", "large printer working", "laser printer working", "power station working", "solar generator parts", "stereo receiver parts", "subwoofer accessories", "tv small with charger", "amplifier with charger", "computer monitor parts", "gaming monitor working", "portable power station", "solar generator bundle", "solar generator tested", "stereo receiver bundle", "stereo receiver tested", "subwoofer with charger", "television accessories", "ups battery backup kit", "ups battery backup lot", "av receiver accessories", "computer monitor bundle", "computer monitor tested", "large mixer accessories", "solar generator working", "stereo receiver working", "television with charger", "ups battery backup used", "av receiver with charger", "computer monitor working", "home theater accessories", "large mixer with charger", "speaker pair accessories", "ups battery backup parts", "desktop tower accessories", "dj controller accessories", "home theater with charger", "large printer accessories", "laser printer accessories", "power station accessories", "speaker pair with charger", "ups battery backup bundle", "ups battery backup tested", "desktop tower with charger", "dj controller with charger", "gaming monitor accessories", "large printer with charger", "laser printer with charger", "portable power station kit", "portable power station lot", "power station with charger", "ups battery backup working", "gaming monitor with charger", "portable power station used", "solar generator accessories", "stereo receiver accessories", "computer monitor accessories", "portable power station parts", "solar generator with charger", "stereo receiver with charger", "computer monitor with charger", "portable power station bundle", "portable power station tested", "portable power station working", "ups battery backup accessories", "ups battery backup with charger", "portable power station accessories", "portable power station with charger"],
  automotiveHandTool: ["ratchet", "otc tool", "vise grip", "lisle tool", "pliers set", "socket set", "wrench set", "breaker bar", "code reader", "gear puller", "obd scanner", "pickle fork", "ratchet kit", "ratchet lot", "spanner set", "husky socket", "matco wrench", "obd2 scanner", "otc tool kit", "otc tool lot", "ratchet used", "timing light", "brake bleeder", "kobalt socket", "otc tool used", "ratchet parts", "tekton wrench", "torque wrench", "vise grip kit", "vise grip lot", "bearing puller", "lisle tool kit", "lisle tool lot", "otc tool parts", "pliers set kit", "pliers set lot", "ratchet bundle", "ratchet tested", "snap on wrench", "socket set kit", "socket set lot", "vise grip used", "wrench set kit", "wrench set lot", "breaker bar kit", "breaker bar lot", "code reader kit", "code reader lot", "gear puller kit", "gear puller lot", "lisle tool used", "obd scanner kit", "obd scanner lot", "otc tool bundle", "otc tool tested", "pickle fork kit", "pickle fork lot", "pliers set used", "ratchet working", "screwdriver set", "socket set used", "spanner set kit", "spanner set lot", "tap and die set", "vise grip parts", "wrench set used", "breaker bar used", "code reader used", "craftsman socket", "gear puller used", "husky socket kit", "husky socket lot", "lisle tool parts", "mac tools wrench", "matco wrench kit", "matco wrench lot", "obd scanner used", "obd2 scanner kit", "obd2 scanner lot", "otc tool working", "pickle fork used", "pliers set parts", "socket set parts", "spanner set used", "timing light kit", "timing light lot", "vise grip bundle", "vise grip tested", "wrench set parts", "brake bleeder kit", "brake bleeder lot", "breaker bar parts", "code reader parts", "gear puller parts", "husky socket used", "kobalt socket kit", "kobalt socket lot", "lisle tool bundle", "lisle tool tested", "matco wrench used", "obd scanner parts", "obd2 scanner used", "oil filter wrench", "pickle fork parts", "pliers set bundle", "pliers set tested", "socket set bundle", "socket set tested", "spanner set parts", "spark plug socket", "tekton wrench kit", "tekton wrench lot", "timing light used", "torque wrench kit", "torque wrench lot", "trim removal tool", "vise grip working", "wrench set bundle", "wrench set tested", "bearing puller kit", "bearing puller lot", "brake bleeder used", "breaker bar bundle", "breaker bar tested", "code reader bundle", "code reader tested", "compression tester", "gear puller bundle", "gear puller tested", "gearwrench ratchet", "husky socket parts", "jump starter small", "kobalt socket used", "lisle tool working", "matco wrench parts", "obd scanner bundle", "obd scanner tested", "obd2 scanner parts", "pickle fork bundle", "pickle fork tested", "pliers set working", "snap on wrench kit", "snap on wrench lot", "socket set working", "spanner set bundle", "spanner set tested", "tekton wrench used", "timing light parts", "torque wrench used", "wrench set working", "bearing puller used", "brake bleeder parts", "breaker bar working", "code reader working", "gear puller working", "husky socket bundle", "husky socket tested", "kobalt socket parts", "matco wrench bundle", "matco wrench tested", "obd scanner working", "obd2 scanner bundle", "obd2 scanner tested", "pickle fork working", "ratchet accessories", "screwdriver set kit", "screwdriver set lot", "snap on wrench used", "spanner set working", "tap and die set kit", "tap and die set lot", "tekton wrench parts", "timing light bundle", "timing light tested", "tire pressure gauge", "torque wrench parts", "ball joint separator", "bearing puller parts", "brake bleeder bundle", "brake bleeder tested", "craftsman socket kit", "craftsman socket lot", "fuel pressure tester", "husky socket working", "kobalt socket bundle", "kobalt socket tested", "mac tools wrench kit", "mac tools wrench lot", "matco wrench working", "obd2 scanner working", "otc tool accessories", "ratchet with charger", "screwdriver set used", "snap on wrench parts", "tap and die set used", "tekton wrench bundle", "tekton wrench tested", "timing light working", "torque wrench bundle", "torque wrench tested", "bearing puller bundle", "bearing puller tested", "brake bleeder working", "craftsman socket used", "kobalt socket working", "mac tools wrench used", "multimeter automotive", "oil filter wrench kit", "oil filter wrench lot", "otc tool with charger", "screwdriver set parts", "snap on wrench bundle", "snap on wrench tested", "spark plug socket kit", "spark plug socket lot", "tap and die set parts", "tekton wrench working", "torque wrench working", "trim removal tool kit", "trim removal tool lot", "vise grip accessories", "bearing puller working", "compression tester kit", "compression tester lot", "craftsman socket parts", "gearwrench ratchet kit", "gearwrench ratchet lot", "jump starter small kit", "jump starter small lot", "lisle tool accessories", "mac tools wrench parts", "oil filter wrench used", "pliers set accessories", "screwdriver set bundle", "screwdriver set tested", "snap on wrench working", "socket set accessories", "spark plug socket used", "tap and die set bundle", "tap and die set tested", "trim removal tool used", "vise grip with charger", "wrench set accessories", "breaker bar accessories", "code reader accessories", "compression tester used", "craftsman socket bundle", "craftsman socket tested", "gear puller accessories", "gearwrench ratchet used", "jump starter small used", "lisle tool with charger", "mac tools wrench bundle", "mac tools wrench tested", "obd scanner accessories", "oil filter wrench parts", "pickle fork accessories", "pliers set with charger", "screwdriver set working", "socket set with charger", "spanner set accessories", "spark plug socket parts", "tap and die set working", "tire pressure gauge kit", "tire pressure gauge lot", "trim removal tool parts", "wrench set with charger", "ball joint separator kit", "ball joint separator lot", "breaker bar with charger", "code reader with charger", "compression tester parts", "craftsman socket working", "fuel pressure tester kit", "fuel pressure tester lot", "gear puller with charger", "gearwrench ratchet parts", "husky socket accessories", "jump starter small parts", "mac tools wrench working", "matco wrench accessories", "obd scanner with charger", "obd2 scanner accessories", "oil filter wrench bundle", "oil filter wrench tested", "pickle fork with charger", "spanner set with charger", "spark plug socket bundle", "spark plug socket tested", "timing light accessories", "tire pressure gauge used", "trim removal tool bundle", "trim removal tool tested", "ball joint separator used", "brake bleeder accessories", "compression tester bundle", "compression tester tested", "fuel pressure tester used", "gearwrench ratchet bundle", "gearwrench ratchet tested", "husky socket with charger", "jump starter small bundle", "jump starter small tested", "kobalt socket accessories", "matco wrench with charger", "multimeter automotive kit", "multimeter automotive lot", "obd2 scanner with charger", "oil filter wrench working", "spark plug socket working", "tekton wrench accessories", "timing light with charger", "tire pressure gauge parts", "torque wrench accessories", "trim removal tool working", "ball joint separator parts", "bearing puller accessories", "brake bleeder with charger", "compression tester working", "fuel pressure tester parts", "gearwrench ratchet working", "jump starter small working", "kobalt socket with charger", "multimeter automotive used", "snap on wrench accessories", "tekton wrench with charger", "tire pressure gauge bundle", "tire pressure gauge tested", "torque wrench with charger", "ball joint separator bundle", "ball joint separator tested", "bearing puller with charger", "fuel pressure tester bundle", "fuel pressure tester tested", "multimeter automotive parts", "screwdriver set accessories", "snap on wrench with charger", "tap and die set accessories", "tire pressure gauge working", "ball joint separator working", "craftsman socket accessories", "fuel pressure tester working", "mac tools wrench accessories", "multimeter automotive bundle", "multimeter automotive tested", "screwdriver set with charger", "tap and die set with charger", "craftsman socket with charger", "mac tools wrench with charger", "multimeter automotive working", "oil filter wrench accessories", "spark plug socket accessories", "trim removal tool accessories", "compression tester accessories", "gearwrench ratchet accessories", "jump starter small accessories", "oil filter wrench with charger", "spark plug socket with charger", "trim removal tool with charger", "compression tester with charger", "gearwrench ratchet with charger", "jump starter small with charger", "tire pressure gauge accessories", "ball joint separator accessories", "fuel pressure tester accessories", "tire pressure gauge with charger", "ball joint separator with charger", "fuel pressure tester with charger", "multimeter automotive accessories", "multimeter automotive with charger"],
  automotivePowerTool: ["buffer", "polisher", "borescope", "scan tool", "buffer kit", "buffer lot", "buffer used", "power probe", "buffer parts", "polisher kit", "polisher lot", "borescope kit", "borescope lot", "buffer bundle", "buffer tested", "impact wrench", "polisher used", "scan tool kit", "scan tool lot", "tire inflator", "borescope used", "buffer working", "polisher parts", "scan tool used", "battery charger", "borescope parts", "polisher bundle", "polisher tested", "power probe kit", "power probe lot", "scan tool parts", "borescope bundle", "borescope tested", "electric ratchet", "floor jack small", "orbital polisher", "polisher working", "power probe used", "scan tool bundle", "scan tool tested", "air impact wrench", "borescope working", "impact wrench kit", "impact wrench lot", "power probe parts", "scan tool working", "tire inflator kit", "tire inflator lot", "buffer accessories", "diagnostic scanner", "impact wrench used", "power probe bundle", "power probe tested", "tire inflator used", "battery charger kit", "battery charger lot", "buffer with charger", "car battery charger", "impact wrench parts", "power probe working", "tire inflator parts", "battery charger used", "battery jump starter", "electric ratchet kit", "electric ratchet lot", "floor jack small kit", "floor jack small lot", "impact wrench bundle", "impact wrench tested", "orbital polisher kit", "orbital polisher lot", "polisher accessories", "tire inflator bundle", "tire inflator tested", "air impact wrench kit", "air impact wrench lot", "battery charger parts", "borescope accessories", "electric ratchet used", "floor jack small used", "impact wrench working", "orbital polisher used", "polisher with charger", "scan tool accessories", "tire inflator working", "air impact wrench used", "battery charger bundle", "battery charger tested", "borescope with charger", "cordless impact wrench", "diagnostic scanner kit", "diagnostic scanner lot", "electric ratchet parts", "floor jack small parts", "orbital polisher parts", "scan tool with charger", "air impact wrench parts", "battery charger working", "car battery charger kit", "car battery charger lot", "diagnostic scanner used", "electric ratchet bundle", "electric ratchet tested", "floor jack small bundle", "floor jack small tested", "orbital polisher bundle", "orbital polisher tested", "portable air compressor", "power probe accessories", "air impact wrench bundle", "air impact wrench tested", "battery jump starter kit", "battery jump starter lot", "car battery charger used", "diagnostic scanner parts", "electric ratchet working", "floor jack small working", "impact driver automotive", "orbital polisher working", "paint sprayer automotive", "power probe with charger", "air impact wrench working", "battery jump starter used", "car battery charger parts", "diagnostic scanner bundle", "diagnostic scanner tested", "impact wrench accessories", "tire inflator accessories", "battery jump starter parts", "car battery charger bundle", "car battery charger tested", "cordless impact wrench kit", "cordless impact wrench lot", "diagnostic scanner working", "impact wrench with charger", "tire inflator with charger", "battery charger accessories", "battery jump starter bundle", "battery jump starter tested", "car battery charger working", "cordless impact wrench used", "portable air compressor kit", "portable air compressor lot", "battery charger with charger", "battery jump starter working", "cordless impact wrench parts", "electric ratchet accessories", "floor jack small accessories", "impact driver automotive kit", "impact driver automotive lot", "inspection camera automotive", "orbital polisher accessories", "paint sprayer automotive kit", "paint sprayer automotive lot", "portable air compressor used", "air impact wrench accessories", "cordless impact wrench bundle", "cordless impact wrench tested", "electric ratchet with charger", "floor jack small with charger", "impact driver automotive used", "orbital polisher with charger", "paint sprayer automotive used", "portable air compressor parts", "air impact wrench with charger", "cordless impact wrench working", "diagnostic scanner accessories", "impact driver automotive parts", "paint sprayer automotive parts", "portable air compressor bundle", "portable air compressor tested", "car battery charger accessories", "diagnostic scanner with charger", "impact driver automotive bundle", "impact driver automotive tested", "paint sprayer automotive bundle", "paint sprayer automotive tested", "portable air compressor working", "battery jump starter accessories", "car battery charger with charger", "impact driver automotive working", "inspection camera automotive kit", "inspection camera automotive lot", "paint sprayer automotive working", "battery jump starter with charger", "inspection camera automotive used", "cordless impact wrench accessories", "inspection camera automotive parts", "cordless impact wrench with charger", "inspection camera automotive bundle", "inspection camera automotive tested", "portable air compressor accessories", "impact driver automotive accessories", "inspection camera automotive working", "paint sprayer automotive accessories", "portable air compressor with charger", "impact driver automotive with charger", "paint sprayer automotive with charger", "inspection camera automotive accessories", "inspection camera automotive with charger"],
  gardenHandTool: ["pruner", "trowel", "weeder", "loppers", "sprayer", "hand rake", "secateurs", "cultivator", "pruner kit", "pruner lot", "soil knife", "trowel kit", "trowel lot", "weeder kit", "weeder lot", "hand pruner", "hose nozzle", "loppers kit", "loppers lot", "pruner used", "sprayer kit", "sprayer lot", "trowel used", "weeder used", "hedge shears", "loppers used", "pruner parts", "sprayer used", "trowel parts", "weeder parts", "bonsai shears", "garden shears", "hand rake kit", "hand rake lot", "loppers parts", "pruner bundle", "pruner tested", "secateurs kit", "secateurs lot", "sprayer parts", "trowel bundle", "trowel tested", "watering wand", "weeder bundle", "weeder tested", "cultivator kit", "cultivator lot", "hand rake used", "loppers bundle", "loppers tested", "pruner working", "secateurs used", "soil knife kit", "soil knife lot", "sprayer bundle", "sprayer tested", "trowel working", "weeder working", "cultivator used", "hand pruner kit", "hand pruner lot", "hand rake parts", "hose nozzle kit", "hose nozzle lot", "loppers working", "secateurs parts", "soil knife used", "sprayer working", "cultivator parts", "hand pruner used", "hand rake bundle", "hand rake tested", "hedge shears kit", "hedge shears lot", "hose nozzle used", "secateurs bundle", "secateurs tested", "soil knife parts", "bonsai shears kit", "bonsai shears lot", "cultivator bundle", "cultivator tested", "garden fork small", "garden gloves lot", "garden shears kit", "garden shears lot", "hand pruner parts", "hand rake working", "hedge shears used", "hose nozzle parts", "secateurs working", "soil knife bundle", "soil knife tested", "watering wand kit", "watering wand lot", "bonsai shears used", "cultivator working", "garden shears used", "hand pruner bundle", "hand pruner tested", "hedge shears parts", "hose nozzle bundle", "hose nozzle tested", "pruner accessories", "soil knife working", "trowel accessories", "watering wand used", "weeder accessories", "bonsai shears parts", "garden shears parts", "hand pruner working", "hedge shears bundle", "hedge shears tested", "hose nozzle working", "loppers accessories", "pruner with charger", "seed spreader small", "sprayer accessories", "trowel with charger", "watering wand parts", "weeder with charger", "bonsai shears bundle", "bonsai shears tested", "garden shears bundle", "garden shears tested", "hedge shears working", "loppers with charger", "sprayer with charger", "watering wand bundle", "watering wand tested", "bonsai shears working", "garden fork small kit", "garden fork small lot", "garden gloves lot kit", "garden gloves lot lot", "garden shears working", "hand rake accessories", "secateurs accessories", "watering wand working", "cultivator accessories", "garden fork small used", "garden gloves lot used", "hand rake with charger", "secateurs with charger", "soil knife accessories", "cultivator with charger", "garden fork small parts", "garden gloves lot parts", "hand pruner accessories", "hose nozzle accessories", "seed spreader small kit", "seed spreader small lot", "soil knife with charger", "garden fork small bundle", "garden fork small tested", "garden gloves lot bundle", "garden gloves lot tested", "hand pruner with charger", "hedge shears accessories", "hose nozzle with charger", "seed spreader small used", "bonsai shears accessories", "garden fork small working", "garden gloves lot working", "garden shears accessories", "hedge shears with charger", "seed spreader small parts", "watering wand accessories", "bonsai shears with charger", "garden shears with charger", "seed spreader small bundle", "seed spreader small tested", "watering wand with charger", "seed spreader small working", "garden fork small accessories", "garden gloves lot accessories", "garden fork small with charger", "garden gloves lot with charger", "seed spreader small accessories", "seed spreader small with charger"],
  gardenPowerTool: ["edger", "edger kit", "edger lot", "edger used", "weed eater", "auger drill", "edger parts", "leaf blower", "edger bundle", "edger tested", "tiller small", "edger working", "hedge trimmer", "pole saw head", "battery blower", "chainsaw small", "string trimmer", "weed eater kit", "weed eater lot", "auger drill kit", "auger drill lot", "electric blower", "lawn mower part", "leaf blower kit", "leaf blower lot", "weed eater used", "auger drill used", "cordless trimmer", "leaf blower used", "tiller small kit", "tiller small lot", "weed eater parts", "auger drill parts", "edger accessories", "hedge trimmer kit", "hedge trimmer lot", "leaf blower parts", "pole saw head kit", "pole saw head lot", "tiller small used", "weed eater bundle", "weed eater tested", "auger drill bundle", "auger drill tested", "battery blower kit", "battery blower lot", "chainsaw small kit", "chainsaw small lot", "edger with charger", "hedge trimmer used", "leaf blower bundle", "leaf blower tested", "pole saw head used", "string trimmer kit", "string trimmer lot", "tiller small parts", "weed eater working", "auger drill working", "battery blower used", "chainsaw small used", "cultivator electric", "electric blower kit", "electric blower lot", "hedge trimmer parts", "lawn mower part kit", "lawn mower part lot", "leaf blower working", "pole saw head parts", "string trimmer used", "tiller small bundle", "tiller small tested", "battery blower parts", "chainsaw small parts", "cordless trimmer kit", "cordless trimmer lot", "electric blower used", "hedge trimmer bundle", "hedge trimmer tested", "lawn mower part used", "pole saw head bundle", "pole saw head tested", "string trimmer parts", "tiller small working", "battery blower bundle", "battery blower tested", "chainsaw small bundle", "chainsaw small tested", "cordless trimmer used", "electric blower parts", "hedge trimmer working", "lawn mower part parts", "pole saw head working", "pressure washer small", "string trimmer bundle", "string trimmer tested", "battery blower working", "chainsaw small working", "cordless trimmer parts", "electric blower bundle", "electric blower tested", "garden sprayer battery", "lawn mower part bundle", "lawn mower part tested", "string trimmer working", "weed eater accessories", "auger drill accessories", "cordless trimmer bundle", "cordless trimmer tested", "cultivator electric kit", "cultivator electric lot", "electric blower working", "lawn mower part working", "leaf blower accessories", "weed eater with charger", "auger drill with charger", "cordless trimmer working", "cultivator electric used", "leaf blower with charger", "tiller small accessories", "cultivator electric parts", "hedge trimmer accessories", "pole saw head accessories", "pressure washer small kit", "pressure washer small lot", "tiller small with charger", "battery blower accessories", "chainsaw small accessories", "cultivator electric bundle", "cultivator electric tested", "garden sprayer battery kit", "garden sprayer battery lot", "hedge trimmer with charger", "pole saw head with charger", "pressure washer small used", "string trimmer accessories", "battery blower with charger", "chainsaw small with charger", "cultivator electric working", "electric blower accessories", "garden sprayer battery used", "lawn mower part accessories", "pressure washer small parts", "string trimmer with charger", "cordless trimmer accessories", "electric blower with charger", "garden sprayer battery parts", "lawn mower part with charger", "pressure washer small bundle", "pressure washer small tested", "cordless trimmer with charger", "garden sprayer battery bundle", "garden sprayer battery tested", "pressure washer small working", "garden sprayer battery working", "cultivator electric accessories", "cultivator electric with charger", "pressure washer small accessories", "garden sprayer battery accessories", "pressure washer small with charger", "garden sprayer battery with charger"],
  longGardenTool: ["hoe", "rake", "spade", "shovel", "hoe kit", "hoe lot", "hoe used", "pole saw", "rake kit", "rake lot", "hoe parts", "pitchfork", "rake used", "spade kit", "spade lot", "garden hoe", "hoe bundle", "hoe tested", "rake parts", "shovel kit", "shovel lot", "spade used", "hoe working", "rake bundle", "rake tested", "shovel used", "snow shovel", "spade parts", "tree pruner", "digging fork", "manual edger", "pole saw kit", "pole saw lot", "rake working", "shovel parts", "spade bundle", "spade tested", "broom outdoor", "pitchfork kit", "pitchfork lot", "pole saw used", "shovel bundle", "shovel tested", "spade working", "garden hoe kit", "garden hoe lot", "landscape rake", "pitchfork used", "pole saw parts", "shovel working", "garden hoe used", "hoe accessories", "pitchfork parts", "pole saw bundle", "pole saw tested", "snow shovel kit", "snow shovel lot", "tree pruner kit", "tree pruner lot", "digging fork kit", "digging fork lot", "garden hoe parts", "hoe with charger", "manual edger kit", "manual edger lot", "pitchfork bundle", "pitchfork tested", "pole saw working", "post hole digger", "rake accessories", "snow shovel used", "tree pruner used", "broom outdoor kit", "broom outdoor lot", "digging fork used", "garden hoe bundle", "garden hoe tested", "manual edger used", "pitchfork working", "rake with charger", "snow shovel parts", "spade accessories", "tree pruner parts", "broom outdoor used", "digging fork parts", "garden hoe working", "landscape rake kit", "landscape rake lot", "long handle pruner", "manual edger parts", "shovel accessories", "snow shovel bundle", "snow shovel tested", "spade with charger", "tree pruner bundle", "tree pruner tested", "broom outdoor parts", "digging fork bundle", "digging fork tested", "landscape rake used", "manual edger bundle", "manual edger tested", "shovel with charger", "snow shovel working", "tree pruner working", "broom outdoor bundle", "broom outdoor tested", "digging fork working", "landscape rake parts", "manual edger working", "pole saw accessories", "post hole digger kit", "post hole digger lot", "broom outdoor working", "landscape rake bundle", "landscape rake tested", "pitchfork accessories", "pole saw with charger", "post hole digger used", "garden hoe accessories", "landscape rake working", "long handle pruner kit", "long handle pruner lot", "pitchfork with charger", "post hole digger parts", "garden hoe with charger", "long handle pruner used", "post hole digger bundle", "post hole digger tested", "snow shovel accessories", "tree pruner accessories", "digging fork accessories", "long handle pruner parts", "manual edger accessories", "post hole digger working", "snow shovel with charger", "tree pruner with charger", "broom outdoor accessories", "digging fork with charger", "long handle pruner bundle", "long handle pruner tested", "manual edger with charger", "broom outdoor with charger", "landscape rake accessories", "long handle pruner working", "landscape rake with charger", "post hole digger accessories", "post hole digger with charger", "long handle pruner accessories", "long handle pruner with charger"],
  watch: ["rolex", "watch", "g shock", "rolex kit", "rolex lot", "tag heuer", "watch kit", "watch lot", "rolex used", "watch case", "watch face", "watch used", "casio watch", "g shock kit", "g shock lot", "omega watch", "rolex parts", "seiko watch", "watch parts", "wrist watch", "fossil watch", "g shock used", "rolex bundle", "rolex tested", "watch bundle", "watch tested", "citizen watch", "g shock parts", "invicta watch", "rolex working", "tag heuer kit", "tag heuer lot", "watch lot kit", "watch lot lot", "watch working", "g shock bundle", "g shock tested", "smartwatch lot", "tag heuer used", "watch case kit", "watch case lot", "watch face kit", "watch face lot", "watch lot used", "apple watch lot", "casio watch kit", "casio watch lot", "g shock working", "omega watch kit", "omega watch lot", "seiko watch kit", "seiko watch lot", "tag heuer parts", "watch case used", "watch face used", "watch lot parts", "wrist watch kit", "wrist watch lot", "casio watch used", "fossil watch kit", "fossil watch lot", "omega watch used", "seiko watch used", "tag heuer bundle", "tag heuer tested", "watch case parts", "watch face parts", "watch lot bundle", "watch lot tested", "wrist watch used", "casio watch parts", "citizen watch kit", "citizen watch lot", "fossil watch used", "invicta watch kit", "invicta watch lot", "omega watch parts", "rolex accessories", "seiko watch parts", "tag heuer working", "watch accessories", "watch case bundle", "watch case tested", "watch face bundle", "watch face tested", "watch lot working", "wrist watch parts", "casio watch bundle", "casio watch tested", "citizen watch used", "fossil watch parts", "invicta watch used", "omega watch bundle", "omega watch tested", "rolex with charger", "seiko watch bundle", "seiko watch tested", "smartwatch lot kit", "smartwatch lot lot", "watch case working", "watch face working", "watch with charger", "wrist watch bundle", "wrist watch tested", "apple watch lot kit", "apple watch lot lot", "casio watch working", "citizen watch parts", "fossil watch bundle", "fossil watch tested", "g shock accessories", "invicta watch parts", "omega watch working", "seiko watch working", "smartwatch lot used", "wrist watch working", "apple watch lot used", "citizen watch bundle", "citizen watch tested", "fossil watch working", "g shock with charger", "invicta watch bundle", "invicta watch tested", "smartwatch lot parts", "apple watch lot parts", "citizen watch working", "invicta watch working", "smartwatch lot bundle", "smartwatch lot tested", "tag heuer accessories", "watch lot accessories", "apple watch lot bundle", "apple watch lot tested", "smartwatch lot working", "tag heuer with charger", "watch case accessories", "watch face accessories", "watch lot with charger", "apple watch lot working", "casio watch accessories", "omega watch accessories", "seiko watch accessories", "watch case with charger", "watch face with charger", "wrist watch accessories", "casio watch with charger", "fossil watch accessories", "omega watch with charger", "seiko watch with charger", "wrist watch with charger", "citizen watch accessories", "fossil watch with charger", "invicta watch accessories", "citizen watch with charger", "invicta watch with charger", "smartwatch lot accessories", "apple watch lot accessories", "smartwatch lot with charger", "apple watch lot with charger"],
  jewelrySmall: ["ring", "charm", "anklet", "brooch", "jewelry", "pendant", "tie bar", "bracelet", "earrings", "necklace", "ring kit", "ring lot", "charm kit", "charm lot", "cufflinks", "gold ring", "jewellery", "ring used", "anklet kit", "anklet lot", "brooch kit", "brooch lot", "charm used", "gold chain", "ring parts", "anklet used", "brooch used", "charm parts", "jewelry kit", "jewelry lot", "pendant kit", "pendant lot", "ring bundle", "ring tested", "silver ring", "tie bar kit", "tie bar lot", "anklet parts", "bracelet kit", "bracelet lot", "brooch parts", "charm bundle", "charm tested", "coin jewelry", "diamond ring", "earrings kit", "earrings lot", "jewelry used", "necklace kit", "necklace lot", "pendant used", "ring working", "silver chain", "tie bar used", "anklet bundle", "anklet tested", "bracelet used", "brooch bundle", "brooch tested", "charm working", "cufflinks kit", "cufflinks lot", "earrings used", "gold ring kit", "gold ring lot", "jewellery kit", "jewellery lot", "jewelry parts", "necklace used", "pendant parts", "tie bar parts", "anklet working", "bracelet parts", "brooch working", "cufflinks used", "earrings parts", "gold chain kit", "gold chain lot", "gold ring used", "jewellery used", "jewelry bundle", "jewelry tested", "necklace parts", "pendant bundle", "pendant tested", "tie bar bundle", "tie bar tested", "bracelet bundle", "bracelet tested", "cufflinks parts", "earrings bundle", "earrings tested", "gold chain used", "gold ring parts", "jewellery parts", "jewelry working", "necklace bundle", "necklace tested", "pendant working", "silver ring kit", "silver ring lot", "tie bar working", "bracelet working", "coin jewelry kit", "coin jewelry lot", "cufflinks bundle", "cufflinks tested", "diamond ring kit", "diamond ring lot", "earrings working", "gold chain parts", "gold ring bundle", "gold ring tested", "jewellery bundle", "jewellery tested", "necklace working", "ring accessories", "silver chain kit", "silver chain lot", "silver ring used", "charm accessories", "coin jewelry used", "cufflinks working", "diamond ring used", "gold chain bundle", "gold chain tested", "gold ring working", "jewellery working", "ring with charger", "silver chain used", "silver ring parts", "anklet accessories", "brooch accessories", "charm with charger", "coin jewelry parts", "diamond ring parts", "gold chain working", "silver chain parts", "silver ring bundle", "silver ring tested", "anklet with charger", "brooch with charger", "coin jewelry bundle", "coin jewelry tested", "diamond ring bundle", "diamond ring tested", "jewelry accessories", "pendant accessories", "silver chain bundle", "silver chain tested", "silver ring working", "tie bar accessories", "bracelet accessories", "coin jewelry working", "diamond ring working", "earrings accessories", "jewelry with charger", "necklace accessories", "pendant with charger", "silver chain working", "tie bar with charger", "bracelet with charger", "cufflinks accessories", "earrings with charger", "gold ring accessories", "jewellery accessories", "necklace with charger", "cufflinks with charger", "gold chain accessories", "gold ring with charger", "jewellery with charger", "gold chain with charger", "silver ring accessories", "coin jewelry accessories", "diamond ring accessories", "silver chain accessories", "silver ring with charger", "coin jewelry with charger", "diamond ring with charger", "silver chain with charger"],
  jewelryLot: ["gold lot", "rings lot", "silver lot", "jewelry lot", "bracelet lot", "gold lot kit", "gold lot lot", "necklace lot", "gold lot used", "mixed jewelry", "rings lot kit", "rings lot lot", "gold lot parts", "rings lot used", "silver lot kit", "silver lot lot", "gold lot bundle", "gold lot tested", "jewelry lot kit", "jewelry lot lot", "rings lot parts", "silver lot used", "bracelet lot kit", "bracelet lot lot", "gold lot working", "jewelry lot used", "necklace lot kit", "necklace lot lot", "rings lot bundle", "rings lot tested", "silver lot parts", "bracelet lot used", "jewelry lot parts", "mixed jewelry kit", "mixed jewelry lot", "necklace lot used", "rings lot working", "silver lot bundle", "silver lot tested", "bracelet lot parts", "jewelry lot bundle", "jewelry lot tested", "mixed jewelry used", "necklace lot parts", "silver lot working", "bracelet lot bundle", "bracelet lot tested", "costume jewelry lot", "jewelry lot working", "mixed jewelry parts", "necklace lot bundle", "necklace lot tested", "bracelet lot working", "gold lot accessories", "mixed jewelry bundle", "mixed jewelry tested", "necklace lot working", "gold lot with charger", "mixed jewelry working", "rings lot accessories", "watch and jewelry lot", "rings lot with charger", "silver lot accessories", "costume jewelry lot kit", "costume jewelry lot lot", "jewelry lot accessories", "silver lot with charger", "bracelet lot accessories", "costume jewelry lot used", "jewelry lot with charger", "necklace lot accessories", "bracelet lot with charger", "costume jewelry lot parts", "mixed jewelry accessories", "necklace lot with charger", "watch and jewelry lot kit", "watch and jewelry lot lot", "costume jewelry lot bundle", "costume jewelry lot tested", "mixed jewelry with charger", "watch and jewelry lot used", "costume jewelry lot working", "watch and jewelry lot parts", "watch and jewelry lot bundle", "watch and jewelry lot tested", "watch and jewelry lot working", "costume jewelry lot accessories", "costume jewelry lot with charger", "watch and jewelry lot accessories", "watch and jewelry lot with charger"],
  musicalInstrumentSmall: ["flute", "kalimba", "ukulele", "clarinet", "flute kit", "flute lot", "harmonica", "flute used", "violin bow", "flute parts", "kalimba kit", "kalimba lot", "ukulele kit", "ukulele lot", "clarinet kit", "clarinet lot", "flute bundle", "flute tested", "guitar pedal", "kalimba used", "ukulele used", "clarinet used", "effects pedal", "flute working", "harmonica kit", "harmonica lot", "kalimba parts", "ukulele parts", "clarinet parts", "harmonica used", "kalimba bundle", "kalimba tested", "ukulele bundle", "ukulele tested", "violin bow kit", "violin bow lot", "clarinet bundle", "clarinet tested", "harmonica parts", "kalimba working", "ukulele working", "violin bow used", "clarinet working", "guitar pedal kit", "guitar pedal lot", "harmonica bundle", "harmonica tested", "pedalboard small", "violin bow parts", "effects pedal kit", "effects pedal lot", "flute accessories", "guitar pedal used", "harmonica working", "violin bow bundle", "violin bow tested", "effects pedal used", "flute with charger", "guitar pedal parts", "trumpet mouthpiece", "violin bow working", "effects pedal parts", "guitar pedal bundle", "guitar pedal tested", "kalimba accessories", "recorder instrument", "ukulele accessories", "clarinet accessories", "effects pedal bundle", "effects pedal tested", "guitar pedal working", "kalimba with charger", "pedalboard small kit", "pedalboard small lot", "ukulele with charger", "clarinet with charger", "effects pedal working", "harmonica accessories", "pedalboard small used", "harmonica with charger", "microphone stand small", "pedalboard small parts", "trumpet mouthpiece kit", "trumpet mouthpiece lot", "violin bow accessories", "pedalboard small bundle", "pedalboard small tested", "recorder instrument kit", "recorder instrument lot", "trumpet mouthpiece used", "violin bow with charger", "guitar pedal accessories", "pedalboard small working", "recorder instrument used", "trumpet mouthpiece parts", "effects pedal accessories", "guitar pedal with charger", "recorder instrument parts", "trumpet mouthpiece bundle", "trumpet mouthpiece tested", "effects pedal with charger", "microphone stand small kit", "microphone stand small lot", "recorder instrument bundle", "recorder instrument tested", "trumpet mouthpiece working", "microphone stand small used", "recorder instrument working", "microphone stand small parts", "pedalboard small accessories", "microphone stand small bundle", "microphone stand small tested", "pedalboard small with charger", "microphone stand small working", "trumpet mouthpiece accessories", "recorder instrument accessories", "trumpet mouthpiece with charger", "recorder instrument with charger", "microphone stand small accessories", "microphone stand small with charger"],
  musicalInstrumentMedium: ["viola", "violin", "trumpet", "mandolin", "saxophone", "viola kit", "viola lot", "snare drum", "viola used", "violin kit", "violin lot", "banjo small", "trumpet kit", "trumpet lot", "viola parts", "violin used", "mandolin kit", "mandolin lot", "trumpet used", "viola bundle", "viola tested", "violin parts", "mandolin used", "midi keyboard", "saxophone kit", "saxophone lot", "trumpet parts", "viola working", "violin bundle", "violin tested", "mandolin parts", "saxophone used", "snare drum kit", "snare drum lot", "trumpet bundle", "trumpet tested", "violin working", "accordion small", "banjo small kit", "banjo small lot", "mandolin bundle", "mandolin tested", "saxophone parts", "snare drum used", "trumpet working", "banjo small used", "mandolin working", "saxophone bundle", "saxophone tested", "snare drum parts", "banjo small parts", "midi keyboard kit", "midi keyboard lot", "saxophone working", "snare drum bundle", "snare drum tested", "viola accessories", "banjo small bundle", "banjo small tested", "midi keyboard used", "snare drum working", "viola with charger", "violin accessories", "accordion small kit", "accordion small lot", "banjo small working", "midi keyboard parts", "studio monitor pair", "trumpet accessories", "violin with charger", "accordion small used", "mandolin accessories", "midi keyboard bundle", "midi keyboard tested", "trumpet with charger", "accordion small parts", "mandolin with charger", "midi keyboard working", "saxophone accessories", "accordion small bundle", "accordion small tested", "audio interface bundle", "saxophone with charger", "snare drum accessories", "accordion small working", "banjo small accessories", "snare drum with charger", "studio monitor pair kit", "studio monitor pair lot", "banjo small with charger", "studio monitor pair used", "midi keyboard accessories", "studio monitor pair parts", "audio interface bundle kit", "audio interface bundle lot", "midi keyboard with charger", "studio monitor pair bundle", "studio monitor pair tested", "accordion small accessories", "audio interface bundle used", "studio monitor pair working", "accordion small with charger", "audio interface bundle parts", "audio interface bundle bundle", "audio interface bundle tested", "audio interface bundle working", "studio monitor pair accessories", "studio monitor pair with charger", "audio interface bundle accessories", "audio interface bundle with charger"],
  guitar: ["guitar", "guitar kit", "guitar lot", "bass guitar", "guitar case", "guitar used", "guitar parts", "fender guitar", "gibson guitar", "guitar bundle", "guitar tested", "ibanez guitar", "guitar gig bag", "guitar working", "acoustic guitar", "bass guitar kit", "bass guitar lot", "electric guitar", "epiphone guitar", "guitar case kit", "guitar case lot", "bass guitar used", "classical guitar", "guitar case used", "bass guitar parts", "fender guitar kit", "fender guitar lot", "gibson guitar kit", "gibson guitar lot", "guitar case parts", "ibanez guitar kit", "ibanez guitar lot", "bass guitar bundle", "bass guitar tested", "fender guitar used", "gibson guitar used", "guitar accessories", "guitar case bundle", "guitar case tested", "guitar gig bag kit", "guitar gig bag lot", "ibanez guitar used", "acoustic guitar kit", "acoustic guitar lot", "bass guitar working", "electric guitar kit", "electric guitar lot", "epiphone guitar kit", "epiphone guitar lot", "fender guitar parts", "gibson guitar parts", "guitar case working", "guitar gig bag used", "guitar with charger", "ibanez guitar parts", "acoustic guitar used", "classical guitar kit", "classical guitar lot", "electric guitar used", "epiphone guitar used", "fender guitar bundle", "fender guitar tested", "gibson guitar bundle", "gibson guitar tested", "guitar gig bag parts", "ibanez guitar bundle", "ibanez guitar tested", "acoustic guitar parts", "classical guitar used", "electric guitar parts", "epiphone guitar parts", "fender guitar working", "gibson guitar working", "guitar gig bag bundle", "guitar gig bag tested", "ibanez guitar working", "acoustic guitar bundle", "acoustic guitar tested", "classical guitar parts", "electric guitar bundle", "electric guitar tested", "epiphone guitar bundle", "epiphone guitar tested", "guitar gig bag working", "acoustic guitar working", "bass guitar accessories", "classical guitar bundle", "classical guitar tested", "electric guitar working", "epiphone guitar working", "guitar case accessories", "bass guitar with charger", "classical guitar working", "guitar case with charger", "fender guitar accessories", "gibson guitar accessories", "ibanez guitar accessories", "fender guitar with charger", "gibson guitar with charger", "guitar gig bag accessories", "ibanez guitar with charger", "acoustic guitar accessories", "electric guitar accessories", "epiphone guitar accessories", "guitar gig bag with charger", "acoustic guitar with charger", "classical guitar accessories", "electric guitar with charger", "epiphone guitar with charger", "classical guitar with charger"],
  keyboardPiano: ["synth", "synth kit", "synth lot", "synth used", "synth parts", "synthesizer", "synth bundle", "synth tested", "digital piano", "synth working", "casio keyboard", "keyboard piano", "music keyboard", "roland keyboard", "synthesizer kit", "synthesizer lot", "yamaha keyboard", "synthesizer used", "digital piano kit", "digital piano lot", "synth accessories", "synthesizer parts", "casio keyboard kit", "casio keyboard lot", "digital piano used", "keyboard piano kit", "keyboard piano lot", "music keyboard kit", "music keyboard lot", "synth with charger", "synthesizer bundle", "synthesizer tested", "casio keyboard used", "digital piano parts", "keyboard piano used", "midi keyboard large", "music keyboard used", "roland keyboard kit", "roland keyboard lot", "synthesizer working", "yamaha keyboard kit", "yamaha keyboard lot", "casio keyboard parts", "digital piano bundle", "digital piano tested", "keyboard piano parts", "music keyboard parts", "roland keyboard used", "yamaha keyboard used", "casio keyboard bundle", "casio keyboard tested", "digital piano working", "keyboard piano bundle", "keyboard piano tested", "music keyboard bundle", "music keyboard tested", "roland keyboard parts", "yamaha keyboard parts", "casio keyboard working", "keyboard piano working", "music keyboard working", "roland keyboard bundle", "roland keyboard tested", "yamaha keyboard bundle", "yamaha keyboard tested", "midi keyboard large kit", "midi keyboard large lot", "roland keyboard working", "synthesizer accessories", "yamaha keyboard working", "midi keyboard large used", "synthesizer with charger", "digital piano accessories", "midi keyboard large parts", "casio keyboard accessories", "digital piano with charger", "keyboard piano accessories", "midi keyboard large bundle", "midi keyboard large tested", "music keyboard accessories", "casio keyboard with charger", "keyboard piano with charger", "midi keyboard large working", "music keyboard with charger", "roland keyboard accessories", "yamaha keyboard accessories", "roland keyboard with charger", "yamaha keyboard with charger", "midi keyboard large accessories", "midi keyboard large with charger"],
  droneSmall: ["dji mini", "dji spark", "toy drone", "mini drone", "nano drone", "drone small", "dji mini kit", "dji mini lot", "dji mini used", "dji spark kit", "dji spark lot", "toy drone kit", "toy drone lot", "dji mini parts", "dji spark used", "mini drone kit", "mini drone lot", "nano drone kit", "nano drone lot", "toy drone used", "dji mini bundle", "dji mini tested", "dji spark parts", "drone small kit", "drone small lot", "mini drone used", "nano drone used", "toy drone parts", "dji mini working", "dji spark bundle", "dji spark tested", "drone small used", "mini drone parts", "nano drone parts", "toy drone bundle", "toy drone tested", "dji spark working", "drone small parts", "mini drone bundle", "mini drone tested", "nano drone bundle", "nano drone tested", "toy drone working", "drone small bundle", "drone small tested", "mini drone working", "nano drone working", "drone small working", "dji mini accessories", "dji mini with charger", "dji spark accessories", "drone battery charger", "toy drone accessories", "dji spark with charger", "mini drone accessories", "nano drone accessories", "toy drone with charger", "drone small accessories", "mini drone with charger", "nano drone with charger", "drone small with charger", "drone battery charger kit", "drone battery charger lot", "drone battery charger used", "drone battery charger parts", "drone battery charger bundle", "drone battery charger tested", "drone battery charger working", "drone battery charger accessories", "drone battery charger with charger"],
  droneLarge: ["drone", "dji air", "dji avata", "dji mavic", "drone kit", "drone lot", "drone used", "autel drone", "dji air kit", "dji air lot", "dji phantom", "drone parts", "dji air used", "drone bundle", "drone tested", "parrot drone", "dji air parts", "dji avata kit", "dji avata lot", "dji mavic kit", "dji mavic lot", "drone kit kit", "drone kit lot", "drone working", "dji air bundle", "dji air tested", "dji avata used", "dji mavic used", "drone kit used", "autel drone kit", "autel drone lot", "dji air working", "dji avata parts", "dji mavic parts", "dji phantom kit", "dji phantom lot", "drone kit parts", "autel drone used", "dji avata bundle", "dji avata tested", "dji mavic bundle", "dji mavic tested", "dji phantom used", "drone bundle kit", "drone bundle lot", "drone kit bundle", "drone kit tested", "parrot drone kit", "parrot drone lot", "autel drone parts", "dji avata working", "dji mavic working", "dji phantom parts", "drone accessories", "drone bundle used", "drone kit working", "parrot drone used", "autel drone bundle", "autel drone tested", "dji phantom bundle", "dji phantom tested", "drone bundle parts", "drone with charger", "parrot drone parts", "autel drone working", "dji air accessories", "dji phantom working", "drone bundle bundle", "drone bundle tested", "parrot drone bundle", "parrot drone tested", "dji air with charger", "drone bundle working", "parrot drone working", "dji avata accessories", "dji mavic accessories", "drone kit accessories", "dji avata with charger", "dji mavic with charger", "drone kit with charger", "autel drone accessories", "dji phantom accessories", "autel drone with charger", "dji phantom with charger", "drone bundle accessories", "parrot drone accessories", "drone bundle with charger", "parrot drone with charger"],
  medicalSmall: ["ems unit", "cpap mask", "tens unit", "glucometer", "hearing aid", "ems unit kit", "ems unit lot", "cpap mask kit", "cpap mask lot", "ems unit used", "glucose meter", "tens unit kit", "tens unit lot", "cpap mask used", "ems unit parts", "glucometer kit", "glucometer lot", "pulse oximeter", "tens unit used", "cpap mask parts", "ems unit bundle", "ems unit tested", "glucometer used", "hearing aid kit", "hearing aid lot", "tens unit parts", "cpap mask bundle", "cpap mask tested", "ems unit working", "glucometer parts", "hearing aid used", "tens unit bundle", "tens unit tested", "cpap mask working", "glucometer bundle", "glucometer tested", "glucose meter kit", "glucose meter lot", "hearing aid parts", "tens unit working", "glucometer working", "glucose meter used", "hearing aid bundle", "hearing aid tested", "nebulizer portable", "pulse oximeter kit", "pulse oximeter lot", "glucose meter parts", "hearing aid working", "pulse oximeter used", "thermometer medical", "ems unit accessories", "glucose meter bundle", "glucose meter tested", "pulse oximeter parts", "cpap mask accessories", "ems unit with charger", "glucose meter working", "pulse oximeter bundle", "pulse oximeter tested", "tens unit accessories", "blood pressure monitor", "cpap mask with charger", "glucometer accessories", "nebulizer portable kit", "nebulizer portable lot", "pulse oximeter working", "tens unit with charger", "glucometer with charger", "hearing aid accessories", "nebulizer portable used", "thermometer medical kit", "thermometer medical lot", "hearing aid with charger", "nebulizer portable parts", "thermometer medical used", "glucose meter accessories", "nebulizer portable bundle", "nebulizer portable tested", "thermometer medical parts", "blood pressure monitor kit", "blood pressure monitor lot", "glucose meter with charger", "nebulizer portable working", "pulse oximeter accessories", "thermometer medical bundle", "thermometer medical tested", "blood pressure monitor used", "pulse oximeter with charger", "thermometer medical working", "blood pressure monitor parts", "blood pressure monitor bundle", "blood pressure monitor tested", "blood pressure monitor working", "nebulizer portable accessories", "nebulizer portable with charger", "thermometer medical accessories", "thermometer medical with charger", "blood pressure monitor accessories", "blood pressure monitor with charger"],
  medicalMedium: ["breast pump", "cpap machine", "bipap machine", "breast pump kit", "breast pump lot", "medical scanner", "patient monitor", "wheelchair part", "breast pump used", "cpap machine kit", "cpap machine lot", "bipap machine kit", "bipap machine lot", "breast pump parts", "cpap machine used", "bipap machine used", "breast pump bundle", "breast pump tested", "cpap machine parts", "mobility aid small", "bipap machine parts", "breast pump working", "cpap machine bundle", "cpap machine tested", "medical scanner kit", "medical scanner lot", "patient monitor kit", "patient monitor lot", "wheelchair part kit", "wheelchair part lot", "bipap machine bundle", "bipap machine tested", "cpap machine working", "medical scanner used", "patient monitor used", "wheelchair part used", "bipap machine working", "medical scanner parts", "patient monitor parts", "wheelchair part parts", "medical scanner bundle", "medical scanner tested", "mobility aid small kit", "mobility aid small lot", "patient monitor bundle", "patient monitor tested", "wheelchair part bundle", "wheelchair part tested", "breast pump accessories", "medical scanner working", "mobility aid small used", "patient monitor working", "wheelchair part working", "breast pump with charger", "cpap machine accessories", "mobility aid small parts", "bipap machine accessories", "cpap machine with charger", "mobility aid small bundle", "mobility aid small tested", "bipap machine with charger", "mobility aid small working", "medical scanner accessories", "patient monitor accessories", "wheelchair part accessories", "medical scanner with charger", "oxygen concentrator portable", "patient monitor with charger", "wheelchair part with charger", "mobility aid small accessories", "mobility aid small with charger", "oxygen concentrator portable kit", "oxygen concentrator portable lot", "oxygen concentrator portable used", "oxygen concentrator portable parts", "oxygen concentrator portable bundle", "oxygen concentrator portable tested", "oxygen concentrator portable working", "oxygen concentrator portable accessories", "oxygen concentrator portable with charger"],
  smallAppliance: ["keurig", "toaster", "nespresso", "food scale", "hand mixer", "keurig kit", "keurig lot", "keurig used", "toaster kit", "toaster lot", "keurig parts", "toaster used", "waffle maker", "keurig bundle", "keurig tested", "nespresso kit", "nespresso lot", "toaster parts", "vacuum sealer", "coffee grinder", "food scale kit", "food scale lot", "hand mixer kit", "hand mixer lot", "keurig working", "nespresso used", "toaster bundle", "toaster tested", "electric kettle", "food scale used", "hand mixer used", "nespresso parts", "toaster working", "food scale parts", "hand mixer parts", "nespresso bundle", "nespresso tested", "waffle maker kit", "waffle maker lot", "food scale bundle", "food scale tested", "hand mixer bundle", "hand mixer tested", "immersion blender", "nespresso working", "rice cooker small", "vacuum sealer kit", "vacuum sealer lot", "waffle maker used", "coffee grinder kit", "coffee grinder lot", "coffee maker small", "food scale working", "hand mixer working", "keurig accessories", "toaster oven small", "vacuum sealer used", "waffle maker parts", "coffee grinder used", "electric kettle kit", "electric kettle lot", "keurig with charger", "ninja blender small", "toaster accessories", "vacuum sealer parts", "waffle maker bundle", "waffle maker tested", "coffee grinder parts", "electric kettle used", "toaster with charger", "vacuum sealer bundle", "vacuum sealer tested", "waffle maker working", "coffee grinder bundle", "coffee grinder tested", "electric kettle parts", "immersion blender kit", "immersion blender lot", "nespresso accessories", "rice cooker small kit", "rice cooker small lot", "vacuum sealer working", "coffee grinder working", "coffee maker small kit", "coffee maker small lot", "electric kettle bundle", "electric kettle tested", "food scale accessories", "hand mixer accessories", "immersion blender used", "nespresso with charger", "rice cooker small used", "toaster oven small kit", "toaster oven small lot", "coffee maker small used", "electric kettle working", "food scale with charger", "hand mixer with charger", "immersion blender parts", "ninja blender small kit", "ninja blender small lot", "rice cooker small parts", "toaster oven small used", "coffee maker small parts", "immersion blender bundle", "immersion blender tested", "ninja blender small used", "rice cooker small bundle", "rice cooker small tested", "toaster oven small parts", "waffle maker accessories", "coffee maker small bundle", "coffee maker small tested", "immersion blender working", "ninja blender small parts", "rice cooker small working", "toaster oven small bundle", "toaster oven small tested", "vacuum sealer accessories", "waffle maker with charger", "coffee grinder accessories", "coffee maker small working", "ninja blender small bundle", "ninja blender small tested", "toaster oven small working", "vacuum sealer with charger", "coffee grinder with charger", "electric kettle accessories", "ninja blender small working", "electric kettle with charger", "immersion blender accessories", "rice cooker small accessories", "coffee maker small accessories", "immersion blender with charger", "rice cooker small with charger", "toaster oven small accessories", "coffee maker small with charger", "ninja blender small accessories", "toaster oven small with charger", "ninja blender small with charger"],
  mediumAppliance: ["juicer", "serger", "blender", "vitamix", "air fryer", "dehydrator", "juicer kit", "juicer lot", "serger kit", "serger lot", "blender kit", "blender lot", "bread maker", "instant pot", "juicer used", "ninja foodi", "serger used", "stand mixer", "vitamix kit", "vitamix lot", "blender used", "juicer parts", "serger parts", "vitamix used", "air fryer kit", "air fryer lot", "blender parts", "juicer bundle", "juicer tested", "serger bundle", "serger tested", "vitamix parts", "air fryer used", "blender bundle", "blender tested", "dehydrator kit", "dehydrator lot", "food processor", "juicer working", "serger working", "sewing machine", "vitamix bundle", "vitamix tested", "air fryer parts", "blender working", "bread maker kit", "bread maker lot", "dehydrator used", "instant pot kit", "instant pot lot", "ninja foodi kit", "ninja foodi lot", "stand mixer kit", "stand mixer lot", "vitamix working", "air fryer bundle", "air fryer tested", "bread maker used", "dehydrator parts", "espresso machine", "instant pot used", "kitchenaid mixer", "ninja foodi used", "stand mixer used", "air fryer working", "bread maker parts", "breville espresso", "dehydrator bundle", "dehydrator tested", "delonghi espresso", "instant pot parts", "ninja foodi parts", "stand mixer parts", "bread maker bundle", "bread maker tested", "dehydrator working", "food processor kit", "food processor lot", "instant pot bundle", "instant pot tested", "juicer accessories", "ninja foodi bundle", "ninja foodi tested", "serger accessories", "sewing machine kit", "sewing machine lot", "stand mixer bundle", "stand mixer tested", "blender accessories", "bread maker working", "food processor used", "instant pot working", "juicer with charger", "ninja foodi working", "serger with charger", "sewing machine used", "stand mixer working", "vitamix accessories", "blender with charger", "espresso machine kit", "espresso machine lot", "food processor parts", "kitchenaid mixer kit", "kitchenaid mixer lot", "sewing machine parts", "vitamix with charger", "air fryer accessories", "breville espresso kit", "breville espresso lot", "delonghi espresso kit", "delonghi espresso lot", "espresso machine used", "food processor bundle", "food processor tested", "kitchenaid mixer used", "sewing machine bundle", "sewing machine tested", "air fryer with charger", "breville espresso used", "dehydrator accessories", "delonghi espresso used", "espresso machine parts", "food processor working", "kitchenaid mixer parts", "kitchenaid stand mixer", "sewing machine working", "bread maker accessories", "breville espresso parts", "dehydrator with charger", "delonghi espresso parts", "espresso machine bundle", "espresso machine tested", "instant pot accessories", "kitchenaid mixer bundle", "kitchenaid mixer tested", "ninja foodi accessories", "stand mixer accessories", "bread maker with charger", "breville espresso bundle", "breville espresso tested", "delonghi espresso bundle", "delonghi espresso tested", "espresso machine working", "instant pot with charger", "kitchenaid mixer working", "ninja foodi with charger", "stand mixer with charger", "breville espresso working", "delonghi espresso working", "food processor accessories", "kitchenaid stand mixer kit", "kitchenaid stand mixer lot", "sewing machine accessories", "food processor with charger", "kitchenaid stand mixer used", "sewing machine with charger", "espresso machine accessories", "kitchenaid mixer accessories", "kitchenaid stand mixer parts", "breville espresso accessories", "delonghi espresso accessories", "espresso machine with charger", "kitchenaid mixer with charger", "kitchenaid stand mixer bundle", "kitchenaid stand mixer tested", "breville espresso with charger", "delonghi espresso with charger", "kitchenaid stand mixer working", "kitchenaid stand mixer accessories", "kitchenaid stand mixer with charger"],
  powerToolBare: ["drill", "dremel", "jigsaw", "sander", "sawzall", "bosch saw", "drill kit", "drill lot", "ryobi saw", "dewalt saw", "dremel kit", "dremel lot", "drill used", "jigsaw kit", "jigsaw lot", "makita saw", "sander kit", "sander lot", "bosch drill", "dremel used", "drill parts", "hilti drill", "jigsaw used", "rotary tool", "router tool", "ryobi drill", "sander used", "sawzall kit", "sawzall lot", "circular saw", "dewalt drill", "dremel parts", "drill bundle", "drill tested", "jigsaw parts", "makita drill", "metabo drill", "ridgid drill", "sander parts", "sawzall used", "angle grinder", "bosch saw kit", "bosch saw lot", "dremel bundle", "dremel tested", "drill working", "impact driver", "jigsaw bundle", "jigsaw tested", "milwaukee saw", "nail gun bare", "ryobi saw kit", "ryobi saw lot", "sander bundle", "sander tested", "sawzall parts", "bosch saw used", "cordless drill", "dewalt saw kit", "dewalt saw lot", "dremel working", "jigsaw working", "makita saw kit", "makita saw lot", "ryobi saw used", "sander working", "sawzall bundle", "sawzall tested", "bosch drill kit", "bosch drill lot", "bosch saw parts", "craftsman drill", "dewalt saw used", "hilti drill kit", "hilti drill lot", "makita saw used", "milwaukee drill", "rotary tool kit", "rotary tool lot", "router tool kit", "router tool lot", "ryobi drill kit", "ryobi drill lot", "ryobi saw parts", "sawzall working", "bosch drill used", "bosch saw bundle", "bosch saw tested", "circular saw kit", "circular saw lot", "dewalt drill kit", "dewalt drill lot", "dewalt saw parts", "hilti drill used", "makita drill kit", "makita drill lot", "makita saw parts", "metabo drill kit", "metabo drill lot", "oscillating tool", "ridgid drill kit", "ridgid drill lot", "rotary tool used", "router tool used", "ryobi drill used", "ryobi saw bundle", "ryobi saw tested", "angle grinder kit", "angle grinder lot", "bosch drill parts", "bosch saw working", "circular saw used", "dewalt drill used", "dewalt saw bundle", "dewalt saw tested", "drill accessories", "hilti drill parts", "impact driver kit", "impact driver lot", "makita drill used", "makita saw bundle", "makita saw tested", "metabo drill used", "milwaukee saw kit", "milwaukee saw lot", "nail gun bare kit", "nail gun bare lot", "reciprocating saw", "ridgid drill used", "rotary tool parts", "router tool parts", "ryobi drill parts", "ryobi saw working", "angle grinder used", "bosch drill bundle", "bosch drill tested", "circular saw parts", "cordless drill kit", "cordless drill lot", "dewalt drill parts", "dewalt saw working", "dremel accessories", "drill with charger", "hilti drill bundle", "hilti drill tested", "impact driver used", "jigsaw accessories", "makita drill parts", "makita saw working", "metabo drill parts", "milwaukee saw used", "nail gun bare used", "porter cable drill", "ridgid drill parts", "rotary tool bundle", "rotary tool tested", "router tool bundle", "router tool tested", "ryobi drill bundle", "ryobi drill tested", "sander accessories", "angle grinder parts", "bosch drill working", "circular saw bundle", "circular saw tested", "cordless drill used", "craftsman drill kit", "craftsman drill lot", "dewalt drill bundle", "dewalt drill tested", "dremel with charger", "hilti drill working", "impact driver parts", "jigsaw with charger", "makita drill bundle", "makita drill tested", "metabo drill bundle", "metabo drill tested", "milwaukee drill kit", "milwaukee drill lot", "milwaukee saw parts", "nail gun bare parts", "ridgid drill bundle", "ridgid drill tested", "rotary tool working", "router tool working", "ryobi drill working", "sander with charger", "sawzall accessories", "staple gun electric", "angle grinder bundle", "angle grinder tested", "circular saw working", "cordless drill parts", "craftsman drill used", "dewalt drill working", "impact driver bundle", "impact driver tested", "makita drill working", "metabo drill working", "milwaukee drill used", "milwaukee saw bundle", "milwaukee saw tested", "nail gun bare bundle", "nail gun bare tested", "oscillating tool kit", "oscillating tool lot", "ridgid drill working", "sawzall with charger", "angle grinder working", "bosch saw accessories", "cordless drill bundle", "cordless drill tested", "craftsman drill parts", "impact driver working", "milwaukee drill parts", "milwaukee saw working", "nail gun bare working", "oscillating tool used", "reciprocating saw kit", "reciprocating saw lot", "ryobi saw accessories", "bosch saw with charger", "cordless drill working", "craftsman drill bundle", "craftsman drill tested", "dewalt saw accessories", "makita saw accessories", "milwaukee drill bundle", "milwaukee drill tested", "oscillating tool parts", "porter cable drill kit", "porter cable drill lot", "reciprocating saw used", "ryobi saw with charger", "bosch drill accessories", "craftsman drill working", "dewalt saw with charger", "hilti drill accessories", "makita saw with charger", "milwaukee drill working", "oscillating tool bundle", "oscillating tool tested", "porter cable drill used", "reciprocating saw parts", "rotary tool accessories", "router tool accessories", "ryobi drill accessories", "staple gun electric kit", "staple gun electric lot", "bosch drill with charger", "circular saw accessories", "dewalt drill accessories", "hilti drill with charger", "makita drill accessories", "metabo drill accessories", "oscillating tool working", "porter cable drill parts", "reciprocating saw bundle", "reciprocating saw tested", "ridgid drill accessories", "rotary tool with charger", "router tool with charger", "ryobi drill with charger", "staple gun electric used", "angle grinder accessories", "circular saw with charger", "dewalt drill with charger", "impact driver accessories", "makita drill with charger", "metabo drill with charger", "milwaukee saw accessories", "nail gun bare accessories", "porter cable drill bundle", "porter cable drill tested", "reciprocating saw working", "ridgid drill with charger", "staple gun electric parts", "angle grinder with charger", "cordless drill accessories", "impact driver with charger", "milwaukee saw with charger", "nail gun bare with charger", "porter cable drill working", "staple gun electric bundle", "staple gun electric tested", "cordless drill with charger", "craftsman drill accessories", "milwaukee drill accessories", "staple gun electric working", "craftsman drill with charger", "milwaukee drill with charger", "oscillating tool accessories", "oscillating tool with charger", "reciprocating saw accessories", "porter cable drill accessories", "reciprocating saw with charger", "porter cable drill with charger", "staple gun electric accessories", "staple gun electric with charger"],
  powerToolWithBattery: ["power tool battery", "battery and charger", "ryobi drill battery", "dewalt drill battery", "makita drill battery", "tool battery charger", "power tool battery kit", "power tool battery lot", "battery and charger kit", "battery and charger lot", "milwaukee drill battery", "power tool battery used", "ryobi drill battery kit", "ryobi drill battery lot", "battery and charger used", "dewalt drill battery kit", "dewalt drill battery lot", "makita drill battery kit", "makita drill battery lot", "power tool battery parts", "ryobi drill battery used", "tool battery charger kit", "tool battery charger lot", "battery and charger parts", "dewalt drill battery used", "makita drill battery used", "power tool battery bundle", "power tool battery tested", "ryobi drill battery parts", "tool battery charger used", "battery and charger bundle", "battery and charger tested", "cordless tool with battery", "dewalt drill battery parts", "makita drill battery parts", "power tool battery working", "ryobi drill battery bundle", "ryobi drill battery tested", "tool battery charger parts", "battery and charger working", "dewalt drill battery bundle", "dewalt drill battery tested", "makita drill battery bundle", "makita drill battery tested", "milwaukee drill battery kit", "milwaukee drill battery lot", "ryobi drill battery working", "tool battery charger bundle", "tool battery charger tested", "dewalt drill battery working", "makita drill battery working", "milwaukee drill battery used", "tool battery charger working", "milwaukee drill battery parts", "cordless tool with battery kit", "cordless tool with battery lot", "milwaukee drill battery bundle", "milwaukee drill battery tested", "power tool battery accessories", "battery and charger accessories", "cordless tool with battery used", "milwaukee drill battery working", "power tool battery with charger", "ryobi drill battery accessories", "battery and charger with charger", "cordless tool with battery parts", "dewalt drill battery accessories", "makita drill battery accessories", "ryobi drill battery with charger", "tool battery charger accessories", "cordless tool with battery bundle", "cordless tool with battery tested", "dewalt drill battery with charger", "makita drill battery with charger", "tool battery charger with charger", "cordless tool with battery working", "milwaukee drill battery accessories", "milwaukee drill battery with charger", "cordless tool with battery accessories", "cordless tool with battery with charger"],
  powerToolKit: ["combo kit", "drill kit", "ryobi kit", "dewalt kit", "makita kit", "combo kit kit", "combo kit lot", "drill kit kit", "drill kit lot", "milwaukee kit", "ryobi kit kit", "ryobi kit lot", "combo kit used", "dewalt kit kit", "dewalt kit lot", "drill kit used", "makita kit kit", "makita kit lot", "power tool kit", "ryobi kit used", "tool set power", "combo kit parts", "dewalt kit used", "drill kit parts", "makita kit used", "ryobi kit parts", "combo kit bundle", "combo kit tested", "dewalt kit parts", "drill kit bundle", "drill kit tested", "makita kit parts", "ryobi kit bundle", "ryobi kit tested", "combo kit working", "dewalt kit bundle", "dewalt kit tested", "drill kit working", "makita kit bundle", "makita kit tested", "milwaukee kit kit", "milwaukee kit lot", "ryobi kit working", "cordless combo kit", "dewalt kit working", "makita kit working", "milwaukee kit used", "power tool kit kit", "power tool kit lot", "tool set power kit", "tool set power lot", "milwaukee kit parts", "power tool kit used", "tool set power used", "milwaukee kit bundle", "milwaukee kit tested", "power tool kit parts", "tool set power parts", "combo kit accessories", "drill kit accessories", "milwaukee kit working", "power tool kit bundle", "power tool kit tested", "ryobi kit accessories", "tool set power bundle", "tool set power tested", "combo kit with charger", "cordless combo kit kit", "cordless combo kit lot", "dewalt kit accessories", "drill kit with charger", "makita kit accessories", "power tool kit working", "ryobi kit with charger", "tool set power working", "cordless combo kit used", "dewalt kit with charger", "makita kit with charger", "cordless combo kit parts", "cordless combo kit bundle", "cordless combo kit tested", "milwaukee kit accessories", "cordless combo kit working", "milwaukee kit with charger", "power tool kit accessories", "tool set power accessories", "power tool kit with charger", "tool set power with charger", "cordless combo kit accessories", "cordless combo kit with charger"],
  sportsSmall: ["bike light", "bike pedal", "fishing reel", "helmet small", "sports watch", "tennis racket", "baseball glove", "bike light kit", "bike light lot", "bike pedal kit", "bike pedal lot", "golf club head", "bike light used", "bike pedal used", "bike light parts", "bike pedal parts", "fishing reel kit", "fishing reel lot", "helmet small kit", "helmet small lot", "sports watch kit", "sports watch lot", "bike light bundle", "bike light tested", "bike pedal bundle", "bike pedal tested", "fishing reel used", "helmet small used", "pickleball paddle", "skateboard trucks", "sports watch used", "tennis racket kit", "tennis racket lot", "baseball glove kit", "baseball glove lot", "bike light working", "bike pedal working", "fishing reel parts", "golf club head kit", "golf club head lot", "helmet small parts", "sports watch parts", "tennis racket used", "baseball glove used", "fishing reel bundle", "fishing reel tested", "golf club head used", "helmet small bundle", "helmet small tested", "sports watch bundle", "sports watch tested", "tennis racket parts", "baseball glove parts", "fishing reel working", "golf club head parts", "helmet small working", "sports watch working", "tennis racket bundle", "tennis racket tested", "baseball glove bundle", "baseball glove tested", "golf club head bundle", "golf club head tested", "pickleball paddle kit", "pickleball paddle lot", "skateboard trucks kit", "skateboard trucks lot", "tennis racket working", "baseball glove working", "bike light accessories", "bike pedal accessories", "golf club head working", "pickleball paddle used", "skateboard trucks used", "bike light with charger", "bike pedal with charger", "pickleball paddle parts", "skateboard trucks parts", "fishing reel accessories", "helmet small accessories", "pickleball paddle bundle", "pickleball paddle tested", "skateboard trucks bundle", "skateboard trucks tested", "sports watch accessories", "fishing reel with charger", "helmet small with charger", "pickleball paddle working", "skateboard trucks working", "sports watch with charger", "tennis racket accessories", "baseball glove accessories", "golf club head accessories", "tennis racket with charger", "baseball glove with charger", "golf club head with charger", "pickleball paddle accessories", "skateboard trucks accessories", "pickleball paddle with charger", "skateboard trucks with charger"],
  sportsMedium: ["golf club", "ski boots", "bike saddle", "baseball bat", "bike crankset", "boxing gloves", "golf club kit", "golf club lot", "roller skates", "ski boots kit", "ski boots lot", "golf club used", "ski boots used", "bike saddle kit", "bike saddle lot", "golf club parts", "ski boots parts", "snowboard boots", "baseball bat kit", "baseball bat lot", "bike saddle used", "golf club bundle", "golf club tested", "ski boots bundle", "ski boots tested", "baseball bat used", "bike crankset kit", "bike crankset lot", "bike saddle parts", "boxing gloves kit", "boxing gloves lot", "fishing rod short", "golf club working", "roller skates kit", "roller skates lot", "ski boots working", "baseball bat parts", "bike crankset used", "bike saddle bundle", "bike saddle tested", "boxing gloves used", "hockey stick short", "roller skates used", "baseball bat bundle", "baseball bat tested", "bike crankset parts", "bike saddle working", "boxing gloves parts", "roller skates parts", "snowboard boots kit", "snowboard boots lot", "baseball bat working", "bike crankset bundle", "bike crankset tested", "boxing gloves bundle", "boxing gloves tested", "roller skates bundle", "roller skates tested", "snowboard boots used", "bike crankset working", "boxing gloves working", "fishing rod short kit", "fishing rod short lot", "golf club accessories", "roller skates working", "ski boots accessories", "snowboard boots parts", "fishing rod short used", "golf club with charger", "hockey stick short kit", "hockey stick short lot", "ski boots with charger", "snowboard boots bundle", "snowboard boots tested", "bike saddle accessories", "fishing rod short parts", "hockey stick short used", "snowboard boots working", "baseball bat accessories", "bike saddle with charger", "fishing rod short bundle", "fishing rod short tested", "hockey stick short parts", "baseball bat with charger", "bike crankset accessories", "boxing gloves accessories", "fishing rod short working", "hockey stick short bundle", "hockey stick short tested", "roller skates accessories", "bike crankset with charger", "boxing gloves with charger", "hockey stick short working", "roller skates with charger", "snowboard boots accessories", "snowboard boots with charger", "fishing rod short accessories", "fishing rod short with charger", "hockey stick short accessories", "hockey stick short with charger"],
  sportsLong: ["skis", "pool cue", "skis kit", "skis lot", "skis used", "snowboard", "skis parts", "archery bow", "fishing rod", "recurve bow", "skis bundle", "skis tested", "compound bow", "hockey stick", "pool cue kit", "pool cue lot", "skis working", "golf club set", "pool cue used", "snowboard kit", "snowboard lot", "pool cue parts", "snowboard used", "archery bow kit", "archery bow lot", "fishing rod kit", "fishing rod lot", "pool cue bundle", "pool cue tested", "recurve bow kit", "recurve bow lot", "snowboard parts", "archery bow used", "baseball bat lot", "compound bow kit", "compound bow lot", "fishing rod used", "hockey stick kit", "hockey stick lot", "pool cue working", "recurve bow used", "skis accessories", "snowboard bundle", "snowboard tested", "archery bow parts", "compound bow used", "fishing rod parts", "golf club set kit", "golf club set lot", "hockey stick used", "recurve bow parts", "skis with charger", "snowboard working", "archery bow bundle", "archery bow tested", "compound bow parts", "fishing rod bundle", "fishing rod tested", "golf club set used", "hockey stick parts", "recurve bow bundle", "recurve bow tested", "archery bow working", "compound bow bundle", "compound bow tested", "fishing rod working", "golf club set parts", "hockey stick bundle", "hockey stick tested", "recurve bow working", "baseball bat lot kit", "baseball bat lot lot", "compound bow working", "golf club set bundle", "golf club set tested", "hockey stick working", "pool cue accessories", "baseball bat lot used", "golf club set working", "pool cue with charger", "snowboard accessories", "baseball bat lot parts", "snowboard with charger", "archery bow accessories", "baseball bat lot bundle", "baseball bat lot tested", "fishing rod accessories", "recurve bow accessories", "archery bow with charger", "baseball bat lot working", "compound bow accessories", "fishing rod with charger", "hockey stick accessories", "recurve bow with charger", "compound bow with charger", "golf club set accessories", "hockey stick with charger", "golf club set with charger", "baseball bat lot accessories", "baseball bat lot with charger"],
  collectibleSmall: ["coin", "coin kit", "coin lot", "autograph", "coin used", "coin parts", "comic book", "coin bundle", "coin tested", "coin lot kit", "coin lot lot", "coin working", "sports cards", "autograph kit", "autograph lot", "coin lot used", "pokemon cards", "trading cards", "autograph used", "coin lot parts", "comic book kit", "comic book lot", "autograph parts", "coin lot bundle", "coin lot tested", "comic book used", "autograph bundle", "autograph tested", "coin accessories", "coin lot working", "comic book parts", "sports cards kit", "sports cards lot", "stamp collection", "autograph working", "coin with charger", "comic book bundle", "comic book tested", "memorabilia small", "pokemon cards kit", "pokemon cards lot", "small collectible", "sports cards used", "trading cards kit", "trading cards lot", "comic book working", "pokemon cards used", "sports cards parts", "trading cards used", "pokemon cards parts", "sports cards bundle", "sports cards tested", "trading cards parts", "coin lot accessories", "pokemon cards bundle", "pokemon cards tested", "sports cards working", "stamp collection kit", "stamp collection lot", "trading cards bundle", "trading cards tested", "autograph accessories", "coin lot with charger", "memorabilia small kit", "memorabilia small lot", "pokemon cards working", "small collectible kit", "small collectible lot", "stamp collection used", "trading cards working", "autograph with charger", "comic book accessories", "memorabilia small used", "small collectible used", "stamp collection parts", "comic book with charger", "memorabilia small parts", "small collectible parts", "stamp collection bundle", "stamp collection tested", "memorabilia small bundle", "memorabilia small tested", "small collectible bundle", "small collectible tested", "sports cards accessories", "stamp collection working", "memorabilia small working", "pokemon cards accessories", "small collectible working", "sports cards with charger", "trading cards accessories", "pokemon cards with charger", "trading cards with charger", "stamp collection accessories", "memorabilia small accessories", "small collectible accessories", "stamp collection with charger", "memorabilia small with charger", "small collectible with charger"],
  collectibleFigure: ["figurine", "funko pop", "model car", "bobblehead", "diecast car", "anime figure", "figurine kit", "figurine lot", "statue small", "action figure", "figurine used", "funko pop kit", "funko pop lot", "marvel figure", "model car kit", "model car lot", "bobblehead kit", "bobblehead lot", "figurine parts", "funko pop used", "model car used", "bobblehead used", "diecast car kit", "diecast car lot", "figurine bundle", "figurine tested", "funko pop parts", "model car parts", "anime figure kit", "anime figure lot", "bobblehead parts", "diecast car used", "figurine working", "funko pop bundle", "funko pop tested", "model car bundle", "model car tested", "star wars figure", "statue small kit", "statue small lot", "action figure kit", "action figure lot", "anime figure used", "bobblehead bundle", "bobblehead tested", "diecast car parts", "funko pop working", "marvel figure kit", "marvel figure lot", "model car working", "statue small used", "action figure used", "anime figure parts", "bobblehead working", "diecast car bundle", "diecast car tested", "marvel figure used", "statue small parts", "action figure parts", "anime figure bundle", "anime figure tested", "diecast car working", "marvel figure parts", "statue small bundle", "statue small tested", "action figure bundle", "action figure tested", "anime figure working", "figurine accessories", "marvel figure bundle", "marvel figure tested", "star wars figure kit", "star wars figure lot", "statue small working", "action figure working", "figurine with charger", "funko pop accessories", "marvel figure working", "model car accessories", "star wars figure used", "bobblehead accessories", "funko pop with charger", "model car with charger", "star wars figure parts", "bobblehead with charger", "diecast car accessories", "star wars figure bundle", "star wars figure tested", "anime figure accessories", "diecast car with charger", "star wars figure working", "statue small accessories", "action figure accessories", "anime figure with charger", "marvel figure accessories", "statue small with charger", "action figure with charger", "marvel figure with charger", "star wars figure accessories", "star wars figure with charger"],
  collectibleLarge: ["statue", "statue kit", "statue lot", "statue used", "statue parts", "signed helmet", "statue bundle", "statue tested", "large figurine", "lego set large", "porcelain doll", "statue working", "model train set", "signed helmet kit", "signed helmet lot", "vintage toy large", "collectible statue", "large figurine kit", "large figurine lot", "lego set large kit", "lego set large lot", "porcelain doll kit", "porcelain doll lot", "signed helmet used", "statue accessories", "large figurine used", "lego set large used", "model train set kit", "model train set lot", "porcelain doll used", "signed helmet parts", "statue with charger", "large figurine parts", "lego set large parts", "model train set used", "porcelain doll parts", "signed helmet bundle", "signed helmet tested", "large figurine bundle", "large figurine tested", "lego set large bundle", "lego set large tested", "model train set parts", "porcelain doll bundle", "porcelain doll tested", "signed helmet working", "vintage toy large kit", "vintage toy large lot", "collectible statue kit", "collectible statue lot", "large figurine working", "lego set large working", "model train set bundle", "model train set tested", "porcelain doll working", "vintage toy large used", "collectible statue used", "model train set working", "vintage toy large parts", "collectible statue parts", "vintage toy large bundle", "vintage toy large tested", "collectible statue bundle", "collectible statue tested", "signed helmet accessories", "vintage toy large working", "collectible statue working", "large figurine accessories", "lego set large accessories", "porcelain doll accessories", "signed helmet with charger", "large figurine with charger", "lego set large with charger", "model train set accessories", "porcelain doll with charger", "model train set with charger", "vintage toy large accessories", "collectible statue accessories", "vintage toy large with charger", "collectible statue with charger"],
  speakerSmall: ["echo dot", "jbl flip", "sonos roam", "echo dot kit", "echo dot lot", "jbl flip kit", "jbl flip lot", "echo dot used", "jbl flip used", "smart speaker", "echo dot parts", "jbl flip parts", "sonos roam kit", "sonos roam lot", "echo dot bundle", "echo dot tested", "jbl flip bundle", "jbl flip tested", "sonos roam used", "echo dot working", "jbl flip working", "portable speaker", "sonos roam parts", "bluetooth speaker", "smart speaker kit", "smart speaker lot", "sonos roam bundle", "sonos roam tested", "smart speaker used", "sonos roam working", "google nest speaker", "smart speaker parts", "echo dot accessories", "jbl flip accessories", "portable speaker kit", "portable speaker lot", "smart speaker bundle", "smart speaker tested", "bluetooth speaker kit", "bluetooth speaker lot", "bose portable speaker", "echo dot with charger", "jbl flip with charger", "portable speaker used", "smart speaker working", "bluetooth speaker used", "portable speaker parts", "sonos roam accessories", "bluetooth speaker parts", "google nest speaker kit", "google nest speaker lot", "portable speaker bundle", "portable speaker tested", "sonos roam with charger", "bluetooth speaker bundle", "bluetooth speaker tested", "google nest speaker used", "portable speaker working", "bluetooth speaker working", "bose portable speaker kit", "bose portable speaker lot", "google nest speaker parts", "smart speaker accessories", "bose portable speaker used", "google nest speaker bundle", "google nest speaker tested", "smart speaker with charger", "bose portable speaker parts", "google nest speaker working", "bose portable speaker bundle", "bose portable speaker tested", "portable speaker accessories", "bluetooth speaker accessories", "bose portable speaker working", "portable speaker with charger", "bluetooth speaker with charger", "google nest speaker accessories", "google nest speaker with charger", "bose portable speaker accessories", "bose portable speaker with charger"],
  speakerMedium: ["jbl speaker", "bose speaker", "speaker pair", "sonos speaker", "studio monitor", "jbl speaker kit", "jbl speaker lot", "klipsch speaker", "bose speaker kit", "bose speaker lot", "jbl speaker used", "speaker pair kit", "speaker pair lot", "bookshelf speaker", "bose speaker used", "jbl speaker parts", "sonos speaker kit", "sonos speaker lot", "speaker pair used", "bose speaker parts", "jbl speaker bundle", "jbl speaker tested", "sonos speaker used", "speaker pair parts", "studio monitor kit", "studio monitor lot", "bose speaker bundle", "bose speaker tested", "jbl speaker working", "klipsch speaker kit", "klipsch speaker lot", "sonos speaker parts", "speaker pair bundle", "speaker pair tested", "studio monitor used", "bose speaker working", "klipsch speaker used", "sonos speaker bundle", "sonos speaker tested", "speaker pair working", "studio monitor parts", "bookshelf speaker kit", "bookshelf speaker lot", "klipsch speaker parts", "sonos speaker working", "studio monitor bundle", "studio monitor tested", "bookshelf speaker used", "center channel speaker", "klipsch speaker bundle", "klipsch speaker tested", "studio monitor working", "bookshelf speaker parts", "jbl speaker accessories", "klipsch speaker working", "bookshelf speaker bundle", "bookshelf speaker tested", "bose speaker accessories", "jbl speaker with charger", "speaker pair accessories", "bookshelf speaker working", "bose speaker with charger", "sonos speaker accessories", "speaker pair with charger", "center channel speaker kit", "center channel speaker lot", "sonos speaker with charger", "studio monitor accessories", "center channel speaker used", "klipsch speaker accessories", "studio monitor with charger", "center channel speaker parts", "klipsch speaker with charger", "bookshelf speaker accessories", "center channel speaker bundle", "center channel speaker tested", "bookshelf speaker with charger", "center channel speaker working", "center channel speaker accessories", "center channel speaker with charger"],
  speakerLarge: ["subwoofer", "dj speaker", "pa speaker", "floor speaker", "large speaker", "subwoofer kit", "subwoofer lot", "tower speaker", "dj speaker kit", "dj speaker lot", "pa speaker kit", "pa speaker lot", "subwoofer used", "dj speaker used", "pa speaker used", "powered speaker", "subwoofer parts", "dj speaker parts", "pa speaker parts", "subwoofer bundle", "subwoofer tested", "amplified speaker", "dj speaker bundle", "dj speaker tested", "floor speaker kit", "floor speaker lot", "large speaker kit", "large speaker lot", "pa speaker bundle", "pa speaker tested", "subwoofer working", "tower speaker kit", "tower speaker lot", "dj speaker working", "floor speaker used", "large speaker used", "pa speaker working", "tower speaker used", "floor speaker parts", "large speaker parts", "powered speaker kit", "powered speaker lot", "tower speaker parts", "floor speaker bundle", "floor speaker tested", "large speaker bundle", "large speaker tested", "powered speaker used", "tower speaker bundle", "tower speaker tested", "amplified speaker kit", "amplified speaker lot", "floor speaker working", "large speaker working", "powered speaker parts", "subwoofer accessories", "tower speaker working", "amplified speaker used", "dj speaker accessories", "pa speaker accessories", "powered speaker bundle", "powered speaker tested", "subwoofer with charger", "amplified speaker parts", "dj speaker with charger", "pa speaker with charger", "powered speaker working", "amplified speaker bundle", "amplified speaker tested", "amplified speaker working", "floor speaker accessories", "large speaker accessories", "tower speaker accessories", "floor speaker with charger", "large speaker with charger", "tower speaker with charger", "powered speaker accessories", "powered speaker with charger", "amplified speaker accessories", "amplified speaker with charger"],
  monitorSmall: ["monitor 19", "monitor 20", "monitor 21", "monitor 22", "monitor 24", "small monitor", "monitor 19 kit", "monitor 19 lot", "monitor 20 kit", "monitor 20 lot", "monitor 21 kit", "monitor 21 lot", "monitor 22 kit", "monitor 22 lot", "monitor 24 kit", "monitor 24 lot", "monitor 19 used", "monitor 20 used", "monitor 21 used", "monitor 22 used", "monitor 24 used", "monitor 19 parts", "monitor 20 parts", "monitor 21 parts", "monitor 22 parts", "monitor 24 parts", "portable monitor", "monitor 19 bundle", "monitor 19 tested", "monitor 20 bundle", "monitor 20 tested", "monitor 21 bundle", "monitor 21 tested", "monitor 22 bundle", "monitor 22 tested", "monitor 24 bundle", "monitor 24 tested", "small monitor kit", "small monitor lot", "monitor 19 working", "monitor 20 working", "monitor 21 working", "monitor 22 working", "monitor 24 working", "small monitor used", "small monitor parts", "portable monitor kit", "portable monitor lot", "small monitor bundle", "small monitor tested", "portable monitor used", "small monitor working", "monitor 19 accessories", "monitor 20 accessories", "monitor 21 accessories", "monitor 22 accessories", "monitor 24 accessories", "portable monitor parts", "monitor 19 with charger", "monitor 20 with charger", "monitor 21 with charger", "monitor 22 with charger", "monitor 24 with charger", "portable monitor bundle", "portable monitor tested", "portable monitor working", "small monitor accessories", "small monitor with charger", "portable monitor accessories", "portable monitor with charger"],
  monitorLarge: ["monitor 27", "monitor 28", "monitor 30", "monitor 32", "large monitor", "curved display", "curved monitor", "monitor 27 kit", "monitor 27 lot", "monitor 28 kit", "monitor 28 lot", "monitor 30 kit", "monitor 30 lot", "monitor 32 kit", "monitor 32 lot", "27 inch monitor", "32 inch monitor", "34 inch monitor", "49 inch monitor", "monitor 27 used", "monitor 28 used", "monitor 30 used", "monitor 32 used", "monitor 27 parts", "monitor 28 parts", "monitor 30 parts", "monitor 32 parts", "gaming monitor 32", "large monitor kit", "large monitor lot", "monitor 27 bundle", "monitor 27 tested", "monitor 28 bundle", "monitor 28 tested", "monitor 30 bundle", "monitor 30 tested", "monitor 32 bundle", "monitor 32 tested", "ultrawide display", "ultrawide monitor", "curved display kit", "curved display lot", "curved monitor kit", "curved monitor lot", "large monitor used", "monitor 27 working", "monitor 28 working", "monitor 30 working", "monitor 32 working", "27 inch monitor kit", "27 inch monitor lot", "32 inch monitor kit", "32 inch monitor lot", "34 inch monitor kit", "34 inch monitor lot", "49 inch monitor kit", "49 inch monitor lot", "curved display used", "curved monitor used", "large monitor parts", "27 inch monitor used", "32 inch monitor used", "34 inch monitor used", "49 inch monitor used", "curved display parts", "curved monitor parts", "large monitor bundle", "large monitor tested", "27 inch monitor parts", "32 inch monitor parts", "34 inch monitor parts", "49 inch monitor parts", "curved display bundle", "curved display tested", "curved monitor bundle", "curved monitor tested", "gaming monitor 32 kit", "gaming monitor 32 lot", "large monitor working", "ultrawide display kit", "ultrawide display lot", "ultrawide monitor kit", "ultrawide monitor lot", "27 inch monitor bundle", "27 inch monitor tested", "32 inch monitor bundle", "32 inch monitor tested", "34 inch monitor bundle", "34 inch monitor tested", "49 inch monitor bundle", "49 inch monitor tested", "curved display working", "curved monitor working", "gaming monitor 32 used", "monitor 27 accessories", "monitor 28 accessories", "monitor 30 accessories", "monitor 32 accessories", "ultrawide display used", "ultrawide monitor used", "27 inch monitor working", "32 inch monitor working", "34 inch monitor working", "49 inch monitor working", "gaming monitor 32 parts", "monitor 27 with charger", "monitor 28 with charger", "monitor 30 with charger", "monitor 32 with charger", "ultrawide display parts", "ultrawide monitor parts", "gaming monitor 32 bundle", "gaming monitor 32 tested", "ultrawide display bundle", "ultrawide display tested", "ultrawide monitor bundle", "ultrawide monitor tested", "gaming monitor 32 working", "large monitor accessories", "ultrawide display working", "ultrawide monitor working", "curved display accessories", "curved monitor accessories", "large monitor with charger", "27 inch monitor accessories", "32 inch monitor accessories", "34 inch monitor accessories", "49 inch monitor accessories", "curved display with charger", "curved monitor with charger", "27 inch monitor with charger", "32 inch monitor with charger", "34 inch monitor with charger", "49 inch monitor with charger", "gaming monitor 32 accessories", "ultrawide display accessories", "ultrawide monitor accessories", "gaming monitor 32 with charger", "ultrawide display with charger", "ultrawide monitor with charger"],
  carPartSmall: ["car emblem", "tail light", "mirror glass", "fuel injector", "ignition coil", "car emblem kit", "car emblem lot", "headlight bulb", "spark plug set", "tail light kit", "tail light lot", "car emblem used", "tail light used", "car emblem parts", "mirror glass kit", "mirror glass lot", "relay automotive", "tail light parts", "car emblem bundle", "car emblem tested", "fuel injector kit", "fuel injector lot", "ignition coil kit", "ignition coil lot", "mirror glass used", "sensor automotive", "switch automotive", "tail light bundle", "tail light tested", "car emblem working", "fuel injector used", "headlight bulb kit", "headlight bulb lot", "ignition coil used", "mirror glass parts", "spark plug set kit", "spark plug set lot", "tail light working", "fuel injector parts", "headlight bulb used", "ignition coil parts", "mirror glass bundle", "mirror glass tested", "spark plug set used", "fuel injector bundle", "fuel injector tested", "headlight bulb parts", "ignition coil bundle", "ignition coil tested", "mirror glass working", "relay automotive kit", "relay automotive lot", "spark plug set parts", "fuel injector working", "headlight bulb bundle", "headlight bulb tested", "ignition coil working", "relay automotive used", "sensor automotive kit", "sensor automotive lot", "spark plug set bundle", "spark plug set tested", "switch automotive kit", "switch automotive lot", "car emblem accessories", "headlight bulb working", "relay automotive parts", "sensor automotive used", "spark plug set working", "switch automotive used", "tail light accessories", "car emblem with charger", "relay automotive bundle", "relay automotive tested", "sensor automotive parts", "switch automotive parts", "tail light with charger", "mirror glass accessories", "relay automotive working", "sensor automotive bundle", "sensor automotive tested", "switch automotive bundle", "switch automotive tested", "fuel injector accessories", "ignition coil accessories", "mirror glass with charger", "sensor automotive working", "switch automotive working", "fuel injector with charger", "headlight bulb accessories", "ignition coil with charger", "spark plug set accessories", "headlight bulb with charger", "spark plug set with charger", "relay automotive accessories", "relay automotive with charger", "sensor automotive accessories", "switch automotive accessories", "sensor automotive with charger", "switch automotive with charger"],
  carPartMedium: ["ecu", "ecu kit", "ecu lot", "ecu used", "ecu parts", "abs module", "alternator", "ecu bundle", "ecu tested", "pcm module", "ecu working", "side mirror", "brake caliper", "starter motor", "throttle body", "abs module kit", "abs module lot", "alternator kit", "alternator lot", "pcm module kit", "pcm module lot", "abs module used", "alternator used", "ecu accessories", "intake manifold", "pcm module used", "side mirror kit", "side mirror lot", "abs module parts", "alternator parts", "ecu with charger", "pcm module parts", "side mirror used", "abs module bundle", "abs module tested", "alternator bundle", "alternator tested", "brake caliper kit", "brake caliper lot", "pcm module bundle", "pcm module tested", "side mirror parts", "starter motor kit", "starter motor lot", "throttle body kit", "throttle body lot", "abs module working", "alternator working", "brake caliper used", "headlight assembly", "pcm module working", "side mirror bundle", "side mirror tested", "starter motor used", "throttle body used", "brake caliper parts", "intake manifold kit", "intake manifold lot", "side mirror working", "starter motor parts", "tail light assembly", "throttle body parts", "brake caliper bundle", "brake caliper tested", "intake manifold used", "starter motor bundle", "starter motor tested", "throttle body bundle", "throttle body tested", "brake caliper working", "intake manifold parts", "starter motor working", "throttle body working", "abs module accessories", "alternator accessories", "headlight assembly kit", "headlight assembly lot", "intake manifold bundle", "intake manifold tested", "pcm module accessories", "abs module with charger", "alternator with charger", "headlight assembly used", "intake manifold working", "pcm module with charger", "side mirror accessories", "tail light assembly kit", "tail light assembly lot", "headlight assembly parts", "side mirror with charger", "tail light assembly used", "brake caliper accessories", "headlight assembly bundle", "headlight assembly tested", "starter motor accessories", "tail light assembly parts", "throttle body accessories", "brake caliper with charger", "headlight assembly working", "starter motor with charger", "tail light assembly bundle", "tail light assembly tested", "throttle body with charger", "intake manifold accessories", "tail light assembly working", "intake manifold with charger", "headlight assembly accessories", "headlight assembly with charger", "tail light assembly accessories", "tail light assembly with charger"],
  carPartLarge: ["bumper", "fender", "grille", "radiator", "car wheel", "wheel rim", "bumper kit", "bumper lot", "door panel", "fender kit", "fender lot", "grille kit", "grille lot", "bumper used", "control arm", "fender used", "grille used", "bumper parts", "exhaust part", "fender parts", "grille parts", "radiator kit", "radiator lot", "truck mirror", "bumper bundle", "bumper tested", "car wheel kit", "car wheel lot", "fender bundle", "fender tested", "grille bundle", "grille tested", "radiator used", "running board", "wheel rim kit", "wheel rim lot", "bumper working", "car wheel used", "door panel kit", "door panel lot", "fender working", "grille working", "radiator parts", "strut assembly", "wheel rim used", "car wheel parts", "control arm kit", "control arm lot", "door panel used", "radiator bundle", "radiator tested", "wheel rim parts", "car wheel bundle", "car wheel tested", "control arm used", "door panel parts", "exhaust part kit", "exhaust part lot", "radiator working", "truck mirror kit", "truck mirror lot", "wheel rim bundle", "wheel rim tested", "car wheel working", "control arm parts", "door panel bundle", "door panel tested", "exhaust part used", "running board kit", "running board lot", "truck mirror used", "wheel rim working", "bumper accessories", "control arm bundle", "control arm tested", "door panel working", "exhaust part parts", "fender accessories", "grille accessories", "running board used", "strut assembly kit", "strut assembly lot", "truck mirror parts", "bumper with charger", "control arm working", "exhaust part bundle", "exhaust part tested", "fender with charger", "grille with charger", "running board parts", "strut assembly used", "truck mirror bundle", "truck mirror tested", "exhaust part working", "radiator accessories", "running board bundle", "running board tested", "strut assembly parts", "truck mirror working", "car wheel accessories", "radiator with charger", "running board working", "strut assembly bundle", "strut assembly tested", "wheel rim accessories", "car wheel with charger", "door panel accessories", "strut assembly working", "wheel rim with charger", "control arm accessories", "door panel with charger", "control arm with charger", "exhaust part accessories", "truck mirror accessories", "exhaust part with charger", "running board accessories", "truck mirror with charger", "running board with charger", "strut assembly accessories", "strut assembly with charger"],
  battery: ["battery", "battery kit", "battery lot", "battery used", "lipo battery", "battery parts", "drone battery", "battery bundle", "battery tested", "camera battery", "laptop battery", "battery working", "lithium battery", "lipo battery kit", "lipo battery lot", "drone battery kit", "drone battery lot", "lipo battery used", "camera battery kit", "camera battery lot", "drone battery used", "laptop battery kit", "laptop battery lot", "lipo battery parts", "power tool battery", "battery accessories", "camera battery used", "drone battery parts", "laptop battery used", "lipo battery bundle", "lipo battery tested", "lithium battery kit", "lithium battery lot", "lithium ion battery", "portable power bank", "battery with charger", "camera battery parts", "drone battery bundle", "drone battery tested", "jump starter battery", "laptop battery parts", "lipo battery working", "lithium battery used", "camera battery bundle", "camera battery tested", "drone battery working", "laptop battery bundle", "laptop battery tested", "lithium battery parts", "camera battery working", "laptop battery working", "lithium battery bundle", "lithium battery tested", "power tool battery kit", "power tool battery lot", "lithium battery working", "lithium ion battery kit", "lithium ion battery lot", "portable power bank kit", "portable power bank lot", "power tool battery used", "jump starter battery kit", "jump starter battery lot", "lipo battery accessories", "lithium ion battery used", "portable power bank used", "power tool battery parts", "drone battery accessories", "jump starter battery used", "lipo battery with charger", "lithium ion battery parts", "portable power bank parts", "power tool battery bundle", "power tool battery tested", "camera battery accessories", "drone battery with charger", "jump starter battery parts", "laptop battery accessories", "lithium ion battery bundle", "lithium ion battery tested", "portable power bank bundle", "portable power bank tested", "power tool battery working", "camera battery with charger", "jump starter battery bundle", "jump starter battery tested", "laptop battery with charger", "lithium battery accessories", "lithium ion battery working", "portable power bank working", "jump starter battery working", "lithium battery with charger", "power tool battery accessories", "lithium ion battery accessories", "portable power bank accessories", "power tool battery with charger", "jump starter battery accessories", "lithium ion battery with charger", "portable power bank with charger", "jump starter battery with charger"],
  toolKitHeavy: ["tool kit", "tool kit kit", "tool kit lot", "tool kit used", "tool kit parts", "master tool set", "tool kit bundle", "tool kit tested", "socket set large", "tool kit working", "wrench set large", "mechanic tool set", "automotive tool kit", "master tool set kit", "master tool set lot", "tool box with tools", "master tool set used", "socket set large kit", "socket set large lot", "tool kit accessories", "wrench set large kit", "wrench set large lot", "master tool set parts", "mechanic tool set kit", "mechanic tool set lot", "socket set large used", "tool kit with charger", "wrench set large used", "master tool set bundle", "master tool set tested", "mechanic tool set used", "socket set large parts", "wrench set large parts", "automotive tool kit kit", "automotive tool kit lot", "master tool set working", "mechanic tool set parts", "socket set large bundle", "socket set large tested", "tool box with tools kit", "tool box with tools lot", "wrench set large bundle", "wrench set large tested", "automotive tool kit used", "mechanic tool set bundle", "mechanic tool set tested", "socket set large working", "tool box with tools used", "wrench set large working", "automotive tool kit parts", "mechanic tool set working", "tool box with tools parts", "automotive tool kit bundle", "automotive tool kit tested", "tool box with tools bundle", "tool box with tools tested", "automotive tool kit working", "master tool set accessories", "tool box with tools working", "master tool set with charger", "socket set large accessories", "wrench set large accessories", "mechanic tool set accessories", "socket set large with charger", "wrench set large with charger", "mechanic tool set with charger", "automotive tool kit accessories", "tool box with tools accessories", "automotive tool kit with charger", "tool box with tools with charger"],
  bundleSmall: ["small lot", "small bundle", "small lot kit", "small lot lot", "small lot used", "phone lot small", "small lot parts", "accessory bundle", "small bundle kit", "small bundle lot", "small lot bundle", "small lot tested", "mixed small items", "small bundle used", "small lot working", "small bundle parts", "phone lot small kit", "phone lot small lot", "small bundle bundle", "small bundle tested", "accessory bundle kit", "accessory bundle lot", "phone lot small used", "small bundle working", "accessory bundle used", "electronics lot small", "mixed small items kit", "mixed small items lot", "phone lot small parts", "small lot accessories", "accessory bundle parts", "mixed small items used", "phone lot small bundle", "phone lot small tested", "small lot with charger", "accessory bundle bundle", "accessory bundle tested", "mixed small items parts", "phone lot small working", "accessory bundle working", "mixed small items bundle", "mixed small items tested", "small bundle accessories", "electronics lot small kit", "electronics lot small lot", "mixed small items working", "small bundle with charger", "electronics lot small used", "electronics lot small parts", "phone lot small accessories", "accessory bundle accessories", "electronics lot small bundle", "electronics lot small tested", "phone lot small with charger", "accessory bundle with charger", "electronics lot small working", "mixed small items accessories", "mixed small items with charger", "electronics lot small accessories", "electronics lot small with charger"],
  bundleMedium: ["bundle", "tool lot", "mixed lot", "bundle kit", "bundle lot", "bundle used", "network lot", "bundle parts", "tool lot kit", "tool lot lot", "bundle bundle", "bundle tested", "camera bundle", "mixed lot kit", "mixed lot lot", "tool lot used", "bundle working", "console bundle", "mixed lot used", "tool lot parts", "electronics lot", "mixed lot parts", "network lot kit", "network lot lot", "tool lot bundle", "tool lot tested", "mixed lot bundle", "mixed lot tested", "network lot used", "tool lot working", "camera bundle kit", "camera bundle lot", "mixed lot working", "network lot parts", "bundle accessories", "camera bundle used", "computer parts lot", "console bundle kit", "console bundle lot", "network lot bundle", "network lot tested", "bundle with charger", "camera bundle parts", "console bundle used", "electronics lot kit", "electronics lot lot", "network lot working", "camera bundle bundle", "camera bundle tested", "console bundle parts", "electronics lot used", "tool lot accessories", "camera bundle working", "console bundle bundle", "console bundle tested", "electronics lot parts", "mixed lot accessories", "tool lot with charger", "computer parts lot kit", "computer parts lot lot", "console bundle working", "electronics lot bundle", "electronics lot tested", "mixed lot with charger", "computer parts lot used", "electronics lot working", "network lot accessories", "computer parts lot parts", "network lot with charger", "camera bundle accessories", "computer parts lot bundle", "computer parts lot tested", "camera bundle with charger", "computer parts lot working", "console bundle accessories", "console bundle with charger", "electronics lot accessories", "electronics lot with charger", "computer parts lot accessories", "computer parts lot with charger"],
  bundleLargeMultiBox: ["bulk lot", "large lot", "pallet lot", "bulk lot kit", "bulk lot lot", "bulk lot used", "large lot kit", "large lot lot", "multi box lot", "bulk lot parts", "large lot used", "pallet lot kit", "pallet lot lot", "tool chest lot", "bulk lot bundle", "bulk lot tested", "large lot parts", "pallet lot used", "bulk lot working", "large lot bundle", "large lot tested", "pallet lot parts", "large lot working", "multi box lot kit", "multi box lot lot", "pallet lot bundle", "pallet lot tested", "monitor with stand", "multi box lot used", "pallet lot working", "tool chest lot kit", "tool chest lot lot", "multi box lot parts", "tool chest lot used", "bulk lot accessories", "multi box lot bundle", "multi box lot tested", "tool chest lot parts", "bulk lot with charger", "computer bundle large", "large lot accessories", "multi box lot working", "tool chest lot bundle", "tool chest lot tested", "large lot with charger", "monitor with stand kit", "monitor with stand lot", "pallet lot accessories", "tool chest lot working", "monitor with stand used", "pallet lot with charger", "console with accessories", "monitor with stand parts", "computer bundle large kit", "computer bundle large lot", "monitor with stand bundle", "monitor with stand tested", "multi box lot accessories", "computer bundle large used", "monitor with stand working", "multi box lot with charger", "tool chest lot accessories", "computer bundle large parts", "tool chest lot with charger", "computer bundle large bundle", "computer bundle large tested", "console with accessories kit", "console with accessories lot", "computer bundle large working", "console with accessories used", "console with accessories parts", "monitor with stand accessories", "console with accessories bundle", "console with accessories tested", "monitor with stand with charger", "console with accessories working", "computer bundle large accessories", "computer bundle large with charger", "console with accessories accessories", "console with accessories with charger"],
  otherWeightOnlySmall: ["wallet", "figurine", "toy small", "watch box", "book small", "multi tool", "sunglasses", "wallet kit", "wallet lot", "jewelry box", "wallet used", "figurine kit", "figurine lot", "wallet parts", "figurine used", "toy small kit", "toy small lot", "trading cards", "wallet bundle", "wallet tested", "watch box kit", "watch box lot", "book small kit", "book small lot", "figurine parts", "multi tool kit", "multi tool lot", "sunglasses kit", "sunglasses lot", "toy small used", "wallet working", "watch box used", "book small used", "figurine bundle", "figurine tested", "jewelry box kit", "jewelry box lot", "multi tool used", "sunglasses used", "toy small parts", "watch box parts", "book small parts", "figurine working", "jewelry box used", "multi tool parts", "sunglasses parts", "toy small bundle", "toy small tested", "watch box bundle", "watch box tested", "book small bundle", "book small tested", "jewelry box parts", "multi tool bundle", "multi tool tested", "small collectible", "sunglasses bundle", "sunglasses tested", "toy small working", "trading cards kit", "trading cards lot", "watch box working", "book small working", "jewelry box bundle", "jewelry box tested", "multi tool working", "sunglasses working", "trading cards used", "wallet accessories", "jewelry box working", "trading cards parts", "wallet with charger", "figurine accessories", "trading cards bundle", "trading cards tested", "figurine with charger", "small collectible kit", "small collectible lot", "toy small accessories", "trading cards working", "watch box accessories", "book small accessories", "multi tool accessories", "small collectible used", "sunglasses accessories", "toy small with charger", "watch box with charger", "book small with charger", "jewelry box accessories", "multi tool with charger", "small collectible parts", "sunglasses with charger", "jewelry box with charger", "small collectible bundle", "small collectible tested", "small collectible working", "trading cards accessories", "trading cards with charger", "small collectible accessories", "small collectible with charger"],
  otherWeightOnlyMedium: ["toy", "boots", "purse", "shoes", "blender", "handbag", "toy kit", "toy lot", "backpack", "tool kit", "toy used", "boots kit", "boots lot", "purse kit", "purse lot", "shoes kit", "shoes lot", "toy parts", "boots used", "purse used", "shoes used", "toy bundle", "toy tested", "blender kit", "blender lot", "boots parts", "handbag kit", "handbag lot", "purse parts", "shoes parts", "toy working", "backpack kit", "backpack lot", "blender used", "boots bundle", "boots tested", "handbag used", "purse bundle", "purse tested", "shoes bundle", "shoes tested", "tool kit kit", "tool kit lot", "backpack used", "blender parts", "boots working", "handbag parts", "purse working", "shoes working", "tool kit used", "backpack parts", "blender bundle", "blender tested", "handbag bundle", "handbag tested", "tool kit parts", "backpack bundle", "backpack tested", "blender working", "handbag working", "small appliance", "tool kit bundle", "tool kit tested", "toy accessories", "backpack working", "tool kit working", "toy with charger", "vacuum accessory", "boots accessories", "purse accessories", "shoes accessories", "boots with charger", "coffee maker small", "collectible figure", "purse with charger", "shoes with charger", "blender accessories", "handbag accessories", "small appliance kit", "small appliance lot", "backpack accessories", "blender with charger", "handbag with charger", "small appliance used", "tool kit accessories", "vacuum accessory kit", "vacuum accessory lot", "backpack with charger", "small appliance parts", "tool kit with charger", "vacuum accessory used", "coffee maker small kit", "coffee maker small lot", "collectible figure kit", "collectible figure lot", "small appliance bundle", "small appliance tested", "vacuum accessory parts", "coffee maker small used", "collectible figure used", "small appliance working", "vacuum accessory bundle", "vacuum accessory tested", "coffee maker small parts", "collectible figure parts", "vacuum accessory working", "coffee maker small bundle", "coffee maker small tested", "collectible figure bundle", "collectible figure tested", "coffee maker small working", "collectible figure working", "small appliance accessories", "small appliance with charger", "vacuum accessory accessories", "vacuum accessory with charger", "coffee maker small accessories", "collectible figure accessories", "coffee maker small with charger", "collectible figure with charger"],
  otherWeightOnlyLarge: ["fan", "lamp", "vacuum", "fan kit", "fan lot", "car part", "fan used", "lamp kit", "lamp lot", "fan parts", "lamp used", "large toy", "fan bundle", "fan tested", "home decor", "lamp parts", "vacuum kit", "vacuum lot", "fan working", "lamp bundle", "lamp tested", "vacuum used", "car part kit", "car part lot", "lamp working", "vacuum parts", "car part used", "large toy kit", "large toy lot", "speaker large", "vacuum bundle", "vacuum tested", "car part parts", "coffee machine", "home decor kit", "home decor lot", "large toy used", "sewing machine", "vacuum working", "car part bundle", "car part tested", "fan accessories", "home decor used", "large toy parts", "car part working", "fan with charger", "home decor parts", "lamp accessories", "large toy bundle", "large toy tested", "home decor bundle", "home decor tested", "lamp with charger", "large toy working", "speaker large kit", "speaker large lot", "coffee machine kit", "coffee machine lot", "home decor working", "sewing machine kit", "sewing machine lot", "speaker large used", "vacuum accessories", "coffee machine used", "sewing machine used", "speaker large parts", "vacuum with charger", "car part accessories", "coffee machine parts", "large appliance part", "sewing machine parts", "speaker large bundle", "speaker large tested", "car part with charger", "coffee machine bundle", "coffee machine tested", "large toy accessories", "sewing machine bundle", "sewing machine tested", "speaker large working", "coffee machine working", "home decor accessories", "large toy with charger", "sewing machine working", "home decor with charger", "large appliance part kit", "large appliance part lot", "large appliance part used", "speaker large accessories", "coffee machine accessories", "large appliance part parts", "sewing machine accessories", "speaker large with charger", "coffee machine with charger", "large appliance part bundle", "large appliance part tested", "sewing machine with charger", "large appliance part working", "large appliance part accessories", "large appliance part with charger"],
  otherWeightOnlyOversize: ["bulky item", "large case", "stand large", "tripod large", "oversize item", "bulky item kit", "bulky item lot", "equipment case", "large case kit", "large case lot", "bulky item used", "large case used", "stand large kit", "stand large lot", "bulky item parts", "large case parts", "stand large used", "tripod large kit", "tripod large lot", "bulky item bundle", "bulky item tested", "large case bundle", "large case tested", "long unknown item", "oversize item kit", "oversize item lot", "stand large parts", "tripod large used", "bulky item working", "equipment case kit", "equipment case lot", "large case working", "large unknown item", "oversize item used", "stand large bundle", "stand large tested", "tripod large parts", "equipment case used", "oversize item parts", "stand large working", "tripod large bundle", "tripod large tested", "equipment case parts", "oversize item bundle", "oversize item tested", "tripod large working", "equipment case bundle", "equipment case tested", "long unknown item kit", "long unknown item lot", "oversize item working", "bulky item accessories", "equipment case working", "large case accessories", "large unknown item kit", "large unknown item lot", "long unknown item used", "bulky item with charger", "large case with charger", "large unknown item used", "long unknown item parts", "stand large accessories", "large unknown item parts", "long unknown item bundle", "long unknown item tested", "stand large with charger", "tripod large accessories", "large unknown item bundle", "large unknown item tested", "long unknown item working", "oversize item accessories", "tripod large with charger", "equipment case accessories", "large unknown item working", "oversize item with charger", "equipment case with charger", "long unknown item accessories", "large unknown item accessories", "long unknown item with charger", "large unknown item with charger"]
};

export const PACKAGING_PROFILE_ALIAS_COUNT = 9456;

export function normalizeProductText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+\-\.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectPackagingProfileKey(input: {
  productName: string;
  category?: string;
  actualWeightLbs?: number;
  actualDimensions?: { lengthIn: number; widthIn: number; heightIn: number };
}): {
  profileKey: PackagingProfileKey;
  matchedAlias?: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidenceSource: PackagingSourceConfidence;
} {
  if (input.actualDimensions) {
    return {
      profileKey: profileFromActualDimensions(input.actualDimensions, input.actualWeightLbs),
      confidence: "HIGH",
      confidenceSource: "ACTUAL_DIMENSIONS",
    };
  }

  const normalized = normalizeProductText(input.productName);
  let best: { key: PackagingProfileKey; alias: string; score: number } | undefined;

  for (const [key, aliasList] of Object.entries(packagingProfileAliases) as [PackagingProfileKey, string[]][]) {
    for (const alias of aliasList) {
      const a = normalizeProductText(alias);
      if (!a) continue;

      const exact = normalized === a;
      const contains = normalized.includes(a);
      const tokenHit = a.split(" ").every((token) => normalized.includes(token));

      const score = exact ? 100 : contains ? 90 : tokenHit ? 75 : 0;
      if (score > 0 && (!best || score > best.score || a.length > best.alias.length)) {
        best = { key, alias, score };
      }
    }
  }

  if (best) {
    return {
      profileKey: best.key,
      matchedAlias: best.alias,
      confidence: best.score >= 90 ? "HIGH" : "MEDIUM",
      confidenceSource: best.score >= 90 ? "TITLE_MATCH_HIGH" : "TITLE_MATCH_MEDIUM",
    };
  }

  const categoryProfile = profileFromCategory(input.category);
  if (categoryProfile) {
    return {
      profileKey: categoryProfile,
      confidence: "MEDIUM",
      confidenceSource: "CATEGORY_MATCH",
    };
  }

  return {
    profileKey: profileFromWeight(input.actualWeightLbs ?? 0),
    confidence: "LOW",
    confidenceSource: "WEIGHT_FALLBACK",
  };
}

export function calculateBillableWeightLbs(input: {
  productName: string;
  actualWeightLbs: number;
  category?: string;
  itemValueUsd?: number;
  expectedShippingCostUsd?: number;
  carrierDivisor?: number;
  forceProfileKey?: PackagingProfileKey;
  actualDimensions?: { lengthIn: number; widthIn: number; heightIn: number };
  residentialDelivery?: boolean;
  remoteArea?: boolean;
  fuelSurchargePct?: number;
  multiItemQuantity?: number;
  actualWarehouseMeasurement?: {
    lengthIn?: number;
    widthIn?: number;
    heightIn?: number;
    packedWeightLbs?: number;
    packagingCostUsd?: number;
  };
}): BillableWeightResult {
  const carrierDivisor = input.carrierDivisor ?? 139;

  const detected = input.forceProfileKey
    ? {
        profileKey: input.forceProfileKey,
        confidence: "HIGH" as const,
        confidenceSource: "TITLE_MATCH_HIGH" as const,
      }
    : detectPackagingProfileKey(input);

  const profile = packagingProfiles[detected.profileKey];

  const quantity = Math.max(1, Math.floor(input.multiItemQuantity ?? 1));
  const multiBoxRecommended = profile.multiBoxEligible && quantity > 1;
  const packageCount = multiBoxRecommended ? quantity : 1;

  const box = input.actualDimensions ?? profile.box;
  const packageWeightLbs = profile.packagingWeightLbs * packageCount;
  const packedWeightLbs = roundUpToOunce(Math.max(0, input.actualWeightLbs) + packageWeightLbs);

  const dimensionalWeightLbs = Math.ceil(
    ((box.lengthIn * box.widthIn * box.heightIn) / carrierDivisor) * packageCount
  );

  const billableWeightLbs = Math.max(packedWeightLbs, dimensionalWeightLbs);
  const oversize = isOversize(box, packedWeightLbs);
  const additionalHandlingLikely = isAdditionalHandlingLikely(box, packedWeightLbs, profile.fragilityTier);

  const costBreakdown = estimatePackagingCost(profile, packageCount);
  const surchargeEstimate = estimateSurcharges({
    box,
    packedWeightLbs,
    billableWeightLbs,
    expectedShippingCostUsd: input.expectedShippingCostUsd,
    residentialDelivery: input.residentialDelivery,
    remoteArea: input.remoteArea,
    fuelSurchargePct: input.fuelSurchargePct,
    oversize,
    additionalHandlingLikely,
    hazmatFlags: profile.hazmatFlags,
  });

  const riskReserveUsd = estimateRiskReserveUsd({
    itemValueUsd: input.itemValueUsd ?? 0,
    profile,
    oversize,
    additionalHandlingLikely,
    confidence: detected.confidence,
  });

  const learning = input.actualWarehouseMeasurement
    ? compareAgainstWarehouseMeasurement({
        estimatedProfileKey: detected.profileKey,
        estimatedBox: box,
        estimatedPackedWeightLbs: packedWeightLbs,
        estimatedPackagingCostUsd: costBreakdown.estimatedTotalPackagingCostUsd,
        actual: input.actualWarehouseMeasurement,
      })
    : undefined;

  return {
    profileKey: detected.profileKey,
    packedWeightLbs,
    dimensionalWeightLbs,
    billableWeightLbs,
    pricedBy: dimensionalWeightLbs > packedWeightLbs ? "DIMENSIONAL_WEIGHT" : "ACTUAL_WEIGHT",
    carrierDivisor,
    matchedAlias: detected.matchedAlias,
    confidence: detected.confidence,
    confidenceSource: detected.confidenceSource,
    humanReviewRequired:
      detected.confidence === "LOW" ||
      oversize ||
      profile.hazmatFlags.includes("UNKNOWN_BUNDLE") ||
      profile.fragilityTier === "HAZMAT",
    box,
    packageCount,
    multiBoxRecommended,
    fragile: profile.fragilityTier !== "NORMAL" && profile.fragilityTier !== "HEAVY_DENSE",
    fragilityTier: profile.fragilityTier,
    insurance: profile.insurance || (input.itemValueUsd ?? 0) >= 100,
    highTheft: profile.highTheft,
    hazmatFlags: profile.hazmatFlags,
    oversize,
    additionalHandlingLikely,
    costBreakdown,
    surchargeEstimate,
    riskReserveUsd,
    estimatedPackagingAndRiskCostUsd:
      roundMoney(costBreakdown.estimatedTotalPackagingCostUsd + surchargeEstimate.totalSurchargeRiskUsd + riskReserveUsd),
    learning,
  };
}

function estimatePackagingCost(profile: PackagingProfile, packageCount: number): PackagingCostBreakdown {
  const baseMaterial = profile.materialCostUsd * packageCount;
  const fragilityMultiplier =
    profile.fragilityTier.includes("GLASS") ? 1.55 :
    profile.fragilityTier.includes("FRAGILE") ? 1.35 :
    profile.fragilityTier.includes("HEAVY") ? 1.25 :
    profile.fragilityTier.includes("OVERSIZE") ? 1.4 :
    1.0;

  const boxCostUsd = baseMaterial * 0.38 * fragilityMultiplier;
  const bubbleWrapCostUsd = baseMaterial * 0.18 * fragilityMultiplier;
  const foamCostUsd = baseMaterial * 0.18 * fragilityMultiplier;
  const tapeCostUsd = 0.35 * packageCount;
  const labelCostUsd = 0.18 * packageCount;
  const polyMailerCostUsd = profile.fragilityTier === "NORMAL" ? 0.22 * packageCount : 0;
  const insertCostUsd = profile.highTheft || profile.insurance ? 0.25 * packageCount : 0.1 * packageCount;

  const laborPickInspectPackUsd = profile.laborCostUsd * 0.72 * packageCount;
  const laborPhotoWeighLabelUsd = profile.laborCostUsd * 0.28 * packageCount;

  const totalMaterialCostUsd = roundMoney(
    boxCostUsd + bubbleWrapCostUsd + foamCostUsd + tapeCostUsd + labelCostUsd + polyMailerCostUsd + insertCostUsd
  );
  const totalLaborCostUsd = roundMoney(laborPickInspectPackUsd + laborPhotoWeighLabelUsd);

  return {
    boxCostUsd: roundMoney(boxCostUsd),
    bubbleWrapCostUsd: roundMoney(bubbleWrapCostUsd),
    foamCostUsd: roundMoney(foamCostUsd),
    tapeCostUsd: roundMoney(tapeCostUsd),
    labelCostUsd: roundMoney(labelCostUsd),
    polyMailerCostUsd: roundMoney(polyMailerCostUsd),
    insertCostUsd: roundMoney(insertCostUsd),
    laborPickInspectPackUsd: roundMoney(laborPickInspectPackUsd),
    laborPhotoWeighLabelUsd: roundMoney(laborPhotoWeighLabelUsd),
    totalMaterialCostUsd,
    totalLaborCostUsd,
    estimatedTotalPackagingCostUsd: roundMoney(totalMaterialCostUsd + totalLaborCostUsd),
  };
}

function estimateSurcharges(input: {
  box: { lengthIn: number; widthIn: number; heightIn: number };
  packedWeightLbs: number;
  billableWeightLbs: number;
  expectedShippingCostUsd?: number;
  residentialDelivery?: boolean;
  remoteArea?: boolean;
  fuelSurchargePct?: number;
  oversize: boolean;
  additionalHandlingLikely: boolean;
  hazmatFlags: HazmatFlag[];
}): SurchargeEstimate {
  const baseShip = input.expectedShippingCostUsd ?? Math.max(6, input.billableWeightLbs * 1.15);
  const flags: string[] = [];

  const residentialSurchargeUsd = input.residentialDelivery ? 5.25 : 0;
  if (residentialSurchargeUsd) flags.push("RESIDENTIAL");

  const fuelSurchargeUsd = roundMoney(baseShip * ((input.fuelSurchargePct ?? 14) / 100));
  if (fuelSurchargeUsd) flags.push("FUEL_SURCHARGE_ESTIMATE");

  const remoteAreaSurchargeUsd = input.remoteArea ? 13.5 : 0;
  if (remoteAreaSurchargeUsd) flags.push("REMOTE_AREA");

  const oversizeSurchargeRiskUsd = input.oversize ? 35 : 0;
  if (oversizeSurchargeRiskUsd) flags.push("OVERSIZE_RISK");

  const additionalHandlingRiskUsd = input.additionalHandlingLikely ? 18 : 0;
  if (additionalHandlingRiskUsd) flags.push("ADDITIONAL_HANDLING_RISK");

  const lithiumBatteryHandlingRiskUsd = input.hazmatFlags.some((x) => x.includes("LITHIUM")) ? 4 : 0;
  if (lithiumBatteryHandlingRiskUsd) flags.push("LITHIUM_BATTERY_HANDLING");

  return {
    residentialSurchargeUsd,
    fuelSurchargeUsd,
    remoteAreaSurchargeUsd,
    oversizeSurchargeRiskUsd,
    additionalHandlingRiskUsd,
    lithiumBatteryHandlingRiskUsd,
    totalSurchargeRiskUsd: roundMoney(
      residentialSurchargeUsd +
        fuelSurchargeUsd +
        remoteAreaSurchargeUsd +
        oversizeSurchargeRiskUsd +
        additionalHandlingRiskUsd +
        lithiumBatteryHandlingRiskUsd
    ),
    flags,
  };
}

function estimateRiskReserveUsd(input: {
  itemValueUsd: number;
  profile: PackagingProfile;
  oversize: boolean;
  additionalHandlingLikely: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}): number {
  let pct = 0.015;

  if (input.profile.fragilityTier.includes("FRAGILE")) pct += 0.015;
  if (input.profile.fragilityTier.includes("GLASS")) pct += 0.025;
  if (input.profile.highTheft) pct += 0.02;
  if (input.profile.hazmatFlags.length) pct += 0.015;
  if (input.oversize) pct += 0.02;
  if (input.additionalHandlingLikely) pct += 0.015;
  if (input.confidence === "LOW") pct += 0.025;
  if (input.confidence === "MEDIUM") pct += 0.01;

  return roundMoney(Math.max(1.5, input.itemValueUsd * pct));
}

function compareAgainstWarehouseMeasurement(input: {
  estimatedProfileKey: PackagingProfileKey;
  estimatedBox: { lengthIn: number; widthIn: number; heightIn: number };
  estimatedPackedWeightLbs: number;
  estimatedPackagingCostUsd: number;
  actual: {
    lengthIn?: number;
    widthIn?: number;
    heightIn?: number;
    packedWeightLbs?: number;
    packagingCostUsd?: number;
  };
}): PackagingLearningDelta {
  const estimatedVolume = input.estimatedBox.lengthIn * input.estimatedBox.widthIn * input.estimatedBox.heightIn;
  const actualVolume =
    input.actual.lengthIn && input.actual.widthIn && input.actual.heightIn
      ? input.actual.lengthIn * input.actual.widthIn * input.actual.heightIn
      : undefined;

  const dimensionDeltaPct = actualVolume
    ? ((actualVolume - estimatedVolume) / estimatedVolume) * 100
    : undefined;

  const weightDeltaPct = input.actual.packedWeightLbs
    ? ((input.actual.packedWeightLbs - input.estimatedPackedWeightLbs) / input.estimatedPackedWeightLbs) * 100
    : undefined;

  const costDeltaUsd = input.actual.packagingCostUsd !== undefined
    ? roundMoney(input.actual.packagingCostUsd - input.estimatedPackagingCostUsd)
    : undefined;

  const absDim = Math.abs(dimensionDeltaPct ?? 0);
  const absWeight = Math.abs(weightDeltaPct ?? 0);
  const absCost = Math.abs(costDeltaUsd ?? 0);

  const recommendation =
    absDim > 40 || absWeight > 40 ? "SPLIT_PROFILE" :
    absDim > 20 || absWeight > 20 || absCost > 5 ? "ADJUST_PROFILE" :
    "KEEP_PROFILE";

  return {
    estimatedProfileKey: input.estimatedProfileKey,
    actualLengthIn: input.actual.lengthIn,
    actualWidthIn: input.actual.widthIn,
    actualHeightIn: input.actual.heightIn,
    actualPackedWeightLbs: input.actual.packedWeightLbs,
    actualPackagingCostUsd: input.actual.packagingCostUsd,
    dimensionDeltaPct: dimensionDeltaPct === undefined ? undefined : roundMoney(dimensionDeltaPct),
    weightDeltaPct: weightDeltaPct === undefined ? undefined : roundMoney(weightDeltaPct),
    costDeltaUsd,
    recommendation,
    reason: `dimension_delta_pct=${dimensionDeltaPct ?? "unknown"}; weight_delta_pct=${weightDeltaPct ?? "unknown"}; cost_delta_usd=${costDeltaUsd ?? "unknown"}`,
  };
}

function profileFromActualDimensions(dim: { lengthIn: number; widthIn: number; heightIn: number }, actualWeightLbs = 0): PackagingProfileKey {
  const longest = Math.max(dim.lengthIn, dim.widthIn, dim.heightIn);
  const volume = dim.lengthIn * dim.widthIn * dim.heightIn;

  if (longest >= 40) return "otherWeightOnlyOversize";
  if (volume <= 320 && actualWeightLbs <= 2) return "otherWeightOnlySmall";
  if (volume <= 1000 && actualWeightLbs <= 8) return "otherWeightOnlyMedium";
  if (volume <= 3200 && actualWeightLbs <= 25) return "otherWeightOnlyLarge";
  return "otherWeightOnlyOversize";
}

function profileFromCategory(category?: string): PackagingProfileKey | undefined {
  const c = normalizeProductText(category ?? "");
  if (!c) return undefined;

  if (c.includes("phone")) return "smartphone";
  if (c.includes("tablet")) return "tablet";
  if (c.includes("laptop") || c.includes("computer")) return "laptop";
  if (c.includes("jewelry") || c.includes("watch")) return "jewelrySmall";
  if (c.includes("camera")) return "camera";
  if (c.includes("video game") || c.includes("console")) return "gameConsole";
  if (c.includes("network")) return "networkDevice";
  if (c.includes("automotive") || c.includes("auto")) return "automotiveHandTool";
  if (c.includes("garden") || c.includes("lawn")) return "gardenHandTool";
  if (c.includes("tool")) return "toolKitHeavy";
  if (c.includes("musical")) return "musicalInstrumentMedium";
  if (c.includes("medical")) return "medicalSmall";
  if (c.includes("appliance")) return "smallAppliance";
  if (c.includes("sport")) return "sportsMedium";
  if (c.includes("collectible")) return "collectibleSmall";
  return undefined;
}

function profileFromWeight(weight: number): PackagingProfileKey {
  if (weight <= 2) return "otherWeightOnlySmall";
  if (weight <= 8) return "otherWeightOnlyMedium";
  if (weight <= 25) return "otherWeightOnlyLarge";
  return "otherWeightOnlyOversize";
}

function isOversize(box: { lengthIn: number; widthIn: number; heightIn: number }, packedWeightLbs: number): boolean {
  const sorted = [box.lengthIn, box.widthIn, box.heightIn].sort((a, b) => b - a);
  const length = sorted[0];
  const girth = 2 * (sorted[1] + sorted[2]);
  return length > 48 || length + girth > 105 || packedWeightLbs > 50;
}

function isAdditionalHandlingLikely(
  box: { lengthIn: number; widthIn: number; heightIn: number },
  packedWeightLbs: number,
  fragilityTier: FragilityTier
): boolean {
  const longest = Math.max(box.lengthIn, box.widthIn, box.heightIn);
  const secondLongest = [box.lengthIn, box.widthIn, box.heightIn].sort((a, b) => b - a)[1];
  return packedWeightLbs > 50 || longest > 48 || secondLongest > 30 || fragilityTier.includes("HEAVY");
}

function roundUpToOunce(lbs: number): number {
  return Math.ceil(lbs * 16) / 16;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Example:
// calculateBillableWeightLbs({
//   productName: "Apple iPad Pro 12.9 with case",
//   category: "Electronics > Tablets",
//   actualWeightLbs: 1.5,
//   itemValueUsd: 450,
//   residentialDelivery: true,
// });
