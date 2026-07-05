export type R2ErrorClass = 'AUTH' | 'AUTHZ' | 'CONFIG' | 'NOT_FOUND' | 'BAD_REQUEST' | 'SIGNED_URL_EXPIRED' | 'CONFLICT' | 'SIGNATURE' | 'CHECKSUM' | 'TRANSIENT' | 'RATE_LIMIT' | 'MULTIPART_REQUIRED' | 'UNKNOWN';

export interface R2ErrorPolicy {
  r2Code?: string;
  s3Code?: string;
  httpStatus?: number;
  errorClass: R2ErrorClass;
  retryable: boolean;
  deadLetter: boolean;
  recommendedAction: string;
}

const policies: Record<string, R2ErrorPolicy> = {
  '10002': { r2Code: '10002', s3Code: 'Unauthorized', httpStatus: 401, errorClass: 'AUTH', retryable: false, deadLetter: true, recommendedAction: 'Rotate/check R2 credentials and token scope.' },
  '10003': { r2Code: '10003', s3Code: 'AccessDenied', httpStatus: 403, errorClass: 'AUTHZ', retryable: false, deadLetter: true, recommendedAction: 'Check bucket-scoped token permissions.' },
  '10006': { r2Code: '10006', s3Code: 'NoSuchBucket', httpStatus: 404, errorClass: 'CONFIG', retryable: false, deadLetter: true, recommendedAction: 'Create bucket or fix config.' },
  '10007': { r2Code: '10007', s3Code: 'NoSuchKey', httpStatus: 404, errorClass: 'NOT_FOUND', retryable: false, deadLetter: false, recommendedAction: 'Mark object missing and reconcile registry.' },
  '10012': { r2Code: '10012', s3Code: 'MetadataTooLarge', httpStatus: 400, errorClass: 'BAD_REQUEST', retryable: false, deadLetter: true, recommendedAction: 'Move large metadata to Postgres.' },
  '10018': { r2Code: '10018', s3Code: 'ExpiredRequest', httpStatus: 400, errorClass: 'SIGNED_URL_EXPIRED', retryable: false, deadLetter: false, recommendedAction: 'Regenerate presigned URL.' },
  '10031': { r2Code: '10031', s3Code: 'PreconditionFailed', httpStatus: 412, errorClass: 'CONFLICT', retryable: true, deadLetter: false, recommendedAction: 'Refetch ETag and retry idempotently.' },
  '10035': { r2Code: '10035', s3Code: 'SignatureDoesNotMatch', httpStatus: 403, errorClass: 'SIGNATURE', retryable: false, deadLetter: true, recommendedAction: 'Check endpoint, region auto, and secret key.' },
  '10037': { r2Code: '10037', s3Code: 'BadDigest', httpStatus: 400, errorClass: 'CHECKSUM', retryable: true, deadLetter: false, recommendedAction: 'Recompute checksum and retry upload.' },
  '10043': { r2Code: '10043', s3Code: 'ServiceUnavailable', httpStatus: 503, errorClass: 'TRANSIENT', retryable: true, deadLetter: false, recommendedAction: 'Retry with exponential backoff.' },
  '10058': { r2Code: '10058', s3Code: 'TooManyRequests', httpStatus: 429, errorClass: 'RATE_LIMIT', retryable: true, deadLetter: false, recommendedAction: 'Backoff and avoid multiple writes to same key.' },
  '100100': { r2Code: '100100', s3Code: 'EntityTooLarge', httpStatus: 400, errorClass: 'MULTIPART_REQUIRED', retryable: false, deadLetter: true, recommendedAction: 'Use multipart upload.' },
};

export function classifyR2Error(error: unknown): R2ErrorPolicy {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const codeMatch = message.match(/\((\d{5,6})\)$/) || message.match(/\b(100\d{2,3})\b/);
  if (codeMatch && policies[codeMatch[1]!]) return policies[codeMatch[1]!]!;
  for (const policy of Object.values(policies)) {
    if (policy.s3Code && message.includes(policy.s3Code)) return policy;
  }
  return { errorClass: 'UNKNOWN', retryable: true, deadLetter: false, recommendedAction: 'Retry once, then dead-letter with raw error payload.' };
}

export function shouldRetryR2(error: unknown): boolean {
  return classifyR2Error(error).retryable;
}
