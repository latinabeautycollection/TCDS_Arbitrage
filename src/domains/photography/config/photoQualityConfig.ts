export const PHOTO_QUALITY_CONFIG = {
  minWidth: 1000,
  minHeight: 1000,
  ebayMaxPhotos: 24,
  minSharpnessScore: 62,
  minExposureScore: 60,
  minBackgroundScore: 60,
  approvalScore: 82,
  reviewScore: 68,
  maxWatermarkRisk: 20,
  maxTextOverlayRisk: 20,
  maxAiAlterationRiskAutoApprove: 15,
  duplicateHammingThreshold: 8,
  thumbnailWidth: 320,
  listingMaxWidth: 1600,
  listingMaxHeight: 1600,
  jpegQuality: 90
} as const;
