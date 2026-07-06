export interface ListingImageAsset {
  sourceUrl: string;
  originalUrl?: string;
  cleanedUrl?: string;
  provider?: 'PHOTOROOM' | 'REMOVEBG' | 'NONE';
  role: 'PRIMARY' | 'GALLERY' | 'DETAIL' | 'DEFECT' | 'PACKAGING';
  cleanupStatus: 'PENDING' | 'SKIPPED' | 'SUCCEEDED' | 'FAILED';
  complianceStatus: 'UNKNOWN' | 'PASS' | 'WARN' | 'FAIL';
  width?: number;
  height?: number;
  evidence?: Record<string, unknown>;
}
