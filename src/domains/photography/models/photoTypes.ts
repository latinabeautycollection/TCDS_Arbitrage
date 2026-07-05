export type PhotoRole = 'HERO'|'FRONT'|'BACK'|'LEFT'|'RIGHT'|'TOP'|'BOTTOM'|'SERIAL'|'DEFECT'|'ACCESSORY'|'PACKAGING'|'LABEL'|'UNKNOWN';
export type PhotoApprovalStatus = 'APPROVED'|'REJECTED'|'REVIEW'|'PENDING';
export type ComplianceStatus = 'PASS'|'REVIEW'|'FAIL'|'PENDING';
export type VisionProviderName = 'openai'|'claude'|'gemini'|'local';
export type BackgroundProviderName = 'local'|'removebg'|'photoroom'|'cloudinary'|'none';

export interface PhotoInput {
  uri?: string;
  sourceUrl?: string;
  buffer?: Buffer;
  filename?: string;
  role?: PhotoRole;
  sortOrder?: number;
}

export interface PhotoProcessingContext {
  candidateId?: number;
  listingId?: string;
  sourceListingNormalizedId?: number;
  ebayListingDraftFk?: number;
  categoryKey?: string;
  title?: string;
  brand?: string;
  model?: string;
  conditionText?: string;
  processRunId?: string;
  processStepId?: number;
  correlationId?: string;
  actorType?: 'user'|'worker'|'system'|'api'|'service_account';
  actorId?: string;
  actorName?: string;
}

export interface ImageMetadata {
  width: number;
  height: number;
  mimeType: string;
  fileSizeBytes: number;
  exif: Record<string, unknown>;
  sha256: string;
  perceptualHash: string;
}

export interface VisionAnalysis {
  provider: VisionProviderName;
  model: string;
  success: boolean;
  confidence: number;
  productVisible: boolean;
  watermarkDetected: boolean;
  textOverlayDetected: boolean;
  borderDetected: boolean;
  aiAlterationRisk: number;
  conditionDisclosureRisk: number;
  detectedRole: PhotoRole;
  detectedDefects: string[];
  detectedIdentifiers: string[];
  suggestedReshootReasons: string[];
  raw: Record<string, unknown>;
  latencyMs?: number;
  costEstimateUsd?: number;
  error?: string;
}

export interface VisionConsensusResult {
  providerResults: VisionAnalysis[];
  consensusConfidence: number;
  productVisible: boolean;
  watermarkRiskScore: number;
  textOverlayRiskScore: number;
  borderRiskScore: number;
  aiAlterationRiskScore: number;
  conditionDisclosureRisk: number;
  detectedRole: PhotoRole;
  detectedDefects: string[];
  detectedIdentifiers: string[];
  flags: string[];
  costEstimateUsd: number;
}

export interface PhotoAssetResult {
  originalUri: string;
  processedUri?: string;
  thumbnailUri?: string;
  photoRole: PhotoRole;
  metadata: ImageMetadata;
  processedSha256?: string;
  transformationChain: Array<Record<string, unknown>>;
  providerTrace: Array<Record<string, unknown>>;
  qualityScore: number;
  sharpnessScore: number;
  exposureScore: number;
  backgroundScore: number;
  watermarkRiskScore: number;
  textOverlayRiskScore: number;
  duplicateRiskScore: number;
  authenticityRiskScore: number;
  aiAlterationRiskScore: number;
  ebayComplianceStatus: ComplianceStatus;
  approvalStatus: PhotoApprovalStatus;
  rejectionReasons: string[];
  reviewRequired: boolean;
}

export interface CategoryPhotoRequirement {
  categoryPattern: string;
  requiredRoles: PhotoRole[];
  recommendedRoles: PhotoRole[];
  serialEvidenceRequired: boolean;
  defectDisclosureRequired: boolean;
  minApprovedPhotos: number;
  maxPhotos: number;
  minHeroScore: number;
  minSetScore: number;
  allowedAiEdits: string[];
  forbiddenAiEdits: string[];
}

export interface PhotoSetAssessment {
  listingPhotos: Array<Record<string, unknown>>;
  approvedPhotoCount: number;
  totalPhotoCount: number;
  photoSetQualityScore: number;
  primaryHeroScore: number;
  angleCoverageScore: number;
  defectDisclosureScore: number;
  serialEvidenceScore: number;
  accessoryCoverageScore: number;
  packagingEvidenceScore: number;
  buyerTrustScore: number;
  disputeDefenseScore: number;
  ebayComplianceStatus: ComplianceStatus;
  reviewRequired: boolean;
  missingRequiredAngles: PhotoRole[];
  flags: string[];
}

export interface PhotoProcessingResult {
  context: PhotoProcessingContext;
  listingPhotos: Array<Record<string, unknown>>;
  photoQualityScore: number;
  photoSetAssessment: PhotoSetAssessment;
  assets: PhotoAssetResult[];
}
