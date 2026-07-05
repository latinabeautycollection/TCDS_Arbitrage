import {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { bucketForPurpose, loadR2StorageConfig, type R2BucketPurpose, type R2StorageConfig } from '../config/r2StorageConfig';
import { R2StorageError } from '../errors/R2StorageError';

export interface R2PutInput {
  purpose: R2BucketPurpose;
  key: string;
  body: Buffer | Uint8Array | string | Readable;
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
  storageClass?: 'STANDARD' | 'STANDARD_IA';
  sha256?: string;
}

export interface R2StoredObject {
  bucket: string;
  key: string;
  etag?: string;
  sha256?: string;
  sizeBytes?: number;
  storageClass?: string;
  publicUrl?: string;
}

function normalizeMetadata(metadata: R2PutInput['metadata'] = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (v === null || v === undefined) continue;
    out[k.toLowerCase().replace(/^x-amz-meta-/, '')] = String(v).slice(0, 500);
  }
  return out;
}

async function bodyToBuffer(body: R2PutInput['body']): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function classifyR2Error(error: any): R2StorageError {
  const code = error?.Code || error?.code || error?.name || 'R2_UNKNOWN';
  const status = error?.$metadata?.httpStatusCode;
  const retryable = status === 429 || status === 500 || status === 503 || ['InternalError', 'ServiceUnavailable', 'TooManyRequests', 'ClientDisconnect'].includes(code);
  return new R2StorageError(error?.message || String(error), code, retryable, status, error);
}

export class R2Client {
  public readonly s3: S3Client;
  constructor(private readonly cfg: R2StorageConfig = loadR2StorageConfig()) {
    this.s3 = new S3Client({
      region: cfg.R2_REGION,
      endpoint: cfg.R2_ENDPOINT,
      credentials: { accessKeyId: cfg.R2_ACCESS_KEY_ID, secretAccessKey: cfg.R2_SECRET_ACCESS_KEY },
      forcePathStyle: true,
    });
  }

  bucket(purpose: R2BucketPurpose): string { return bucketForPurpose(this.cfg, purpose); }

  publicUrl(purpose: R2BucketPurpose, key: string): string | undefined {
    if (purpose !== 'processed' || !this.cfg.R2_PUBLIC_MEDIA_BASE_URL) return undefined;
    return `${this.cfg.R2_PUBLIC_MEDIA_BASE_URL.replace(/\/$/, '')}/${encodeURI(key).replace(/%2F/g, '/')}`;
  }

  async headBucket(purpose: R2BucketPurpose): Promise<boolean> {
    try { await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket(purpose) })); return true; }
    catch (e) { throw classifyR2Error(e); }
  }

  async putObject(input: R2PutInput): Promise<R2StoredObject> {
    try {
      const bucket = this.bucket(input.purpose);
      const buffer = await bodyToBuffer(input.body);
      const sha256 = input.sha256 ?? createHash('sha256').update(buffer).digest('hex');
      const res = await this.s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        Body: buffer,
        ContentType: input.contentType,
        CacheControl: input.cacheControl,
        Metadata: normalizeMetadata({ ...input.metadata, sha256 }),
        StorageClass: input.storageClass,
        ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      }));
      return { bucket, key: input.key, etag: res.ETag, sha256, sizeBytes: buffer.length, storageClass: input.storageClass, publicUrl: this.publicUrl(input.purpose, input.key) };
    } catch (e) { throw classifyR2Error(e); }
  }

  async getObject(purpose: R2BucketPurpose, key: string) {
    try { return await this.s3.send(new GetObjectCommand({ Bucket: this.bucket(purpose), Key: key })); }
    catch (e) { throw classifyR2Error(e); }
  }

  async headObject(purpose: R2BucketPurpose, key: string) {
    try { return await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket(purpose), Key: key })); }
    catch (e) { throw classifyR2Error(e); }
  }

  async deleteObject(purpose: R2BucketPurpose, key: string): Promise<void> {
    try { await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket(purpose), Key: key })); }
    catch (e) { throw classifyR2Error(e); }
  }

  async deleteObjects(purpose: R2BucketPurpose, keys: string[]): Promise<void> {
    try {
      for (let i = 0; i < keys.length; i += 1000) {
        await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket(purpose), Delete: { Objects: keys.slice(i, i + 1000).map(Key => ({ Key })) } }));
      }
    } catch (e) { throw classifyR2Error(e); }
  }

  async listObjects(purpose: R2BucketPurpose, prefix: string, limit = 1000) {
    try {
      const bucket = this.bucket(purpose);
      const objects: any[] = [];
      let token: string | undefined;
      do {
        const res = await this.s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: Math.min(limit, 1000), ContinuationToken: token }));
        objects.push(...(res.Contents ?? []));
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token && objects.length < limit);
      return objects;
    } catch (e) { throw classifyR2Error(e); }
  }

  async copyObject(sourcePurpose: R2BucketPurpose, sourceKey: string, targetPurpose: R2BucketPurpose, targetKey: string, storageClass?: 'STANDARD'|'STANDARD_IA') {
    try {
      await this.s3.send(new CopyObjectCommand({
        Bucket: this.bucket(targetPurpose),
        Key: targetKey,
        CopySource: `${this.bucket(sourcePurpose)}/${encodeURIComponent(sourceKey).replace(/%2F/g, '/')}`,
        StorageClass: storageClass,
        MetadataDirective: 'COPY',
      }));
    } catch (e) { throw classifyR2Error(e); }
  }

  async presignedGetUrl(purpose: R2BucketPurpose, key: string, expiresIn = this.cfg.R2_PRESIGNED_URL_TTL_SECONDS): Promise<string> {
    try { return await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket(purpose), Key: key }), { expiresIn }); }
    catch (e) { throw classifyR2Error(e); }
  }

  async configureCors(purpose: R2BucketPurpose, allowedOrigins: string[]): Promise<void> {
    try {
      await this.s3.send(new PutBucketCorsCommand({ Bucket: this.bucket(purpose), CORSConfiguration: { CORSRules: [{ AllowedMethods: ['GET', 'HEAD'], AllowedOrigins: allowedOrigins, AllowedHeaders: ['*'], MaxAgeSeconds: 3600 }] } }));
    } catch (e) { throw classifyR2Error(e); }
  }

  async configureLifecycle(purpose: R2BucketPurpose, daysToIA?: number, daysToDelete?: number): Promise<void> {
    const rules: any[] = [];
    if (daysToIA) rules.push({ ID: `${purpose}-to-ia-${daysToIA}`, Status: 'Enabled', Filter: { Prefix: '' }, Transitions: [{ Days: daysToIA, StorageClass: 'STANDARD_IA' }] });
    if (daysToDelete) rules.push({ ID: `${purpose}-delete-${daysToDelete}`, Status: 'Enabled', Filter: { Prefix: '' }, Expiration: { Days: daysToDelete } });
    try { await this.s3.send(new PutBucketLifecycleConfigurationCommand({ Bucket: this.bucket(purpose), LifecycleConfiguration: { Rules: rules } })); }
    catch (e) { throw classifyR2Error(e); }
  }

  async getLifecycle(purpose: R2BucketPurpose) {
    try { return await this.s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: this.bucket(purpose) })); }
    catch (e) { throw classifyR2Error(e); }
  }

  async multipartPutObject(input: R2PutInput, partSize = 10 * 1024 * 1024): Promise<R2StoredObject> {
    const buffer = await bodyToBuffer(input.body);
    if (buffer.length < this.cfg.R2_MULTIPART_THRESHOLD_BYTES) return this.putObject({ ...input, body: buffer });
    const Bucket = this.bucket(input.purpose);
    let uploadId: string | undefined;
    try {
      const created = await this.s3.send(new CreateMultipartUploadCommand({ Bucket, Key: input.key, ContentType: input.contentType, Metadata: normalizeMetadata(input.metadata), StorageClass: input.storageClass }));
      uploadId = created.UploadId;
      if (!uploadId) throw new Error('R2 multipart upload did not return uploadId');
      const parts: CompletedPart[] = [];
      let partNumber = 1;
      for (let offset = 0; offset < buffer.length; offset += partSize) {
        const part = buffer.subarray(offset, Math.min(offset + partSize, buffer.length));
        const uploaded = await this.s3.send(new UploadPartCommand({ Bucket, Key: input.key, UploadId: uploadId, PartNumber: partNumber, Body: part }));
        parts.push({ ETag: uploaded.ETag, PartNumber: partNumber });
        partNumber += 1;
      }
      const completed = await this.s3.send(new CompleteMultipartUploadCommand({ Bucket, Key: input.key, UploadId: uploadId, MultipartUpload: { Parts: parts } }));
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      return { bucket: Bucket, key: input.key, etag: completed.ETag, sha256, sizeBytes: buffer.length, storageClass: input.storageClass, publicUrl: this.publicUrl(input.purpose, input.key) };
    } catch (e) {
      if (uploadId) await this.s3.send(new AbortMultipartUploadCommand({ Bucket, Key: input.key, UploadId: uploadId })).catch(() => undefined);
      throw classifyR2Error(e);
    }
  }
}
