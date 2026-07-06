import sharp from 'sharp';
import { sha256 } from '../utils/hash';
import { buildR2PhotoKey } from '../utils/r2KeyBuilder';
import { R2Client, type R2StoredObject } from '../providers/r2Client';
import type { R2BucketPurpose } from '../config/r2StorageConfig';

export interface StorePhotoInput {
  buffer: Buffer;
  purpose: R2BucketPurpose;
  contentType?: string;
  candidateId?: string | number | null;
  listingId?: string | null;
  sourceListingNormalizedId?: string | number | null;
  photoSetId?: string | null;
  photoRole?: string;
  index?: number;
  extension?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
  cacheControl?: string;
  storageClass?: 'STANDARD' | 'STANDARD_IA';
}

export interface StoredPhotoObject extends R2StoredObject {
  purpose: R2BucketPurpose;
  contentType: string;
}

export class R2PhotoStorageService {
  constructor(private readonly r2 = new R2Client()) {}

  async storePhoto(input: StorePhotoInput): Promise<StoredPhotoObject> {
    const digest = sha256(input.buffer);
    const ext = input.extension ?? (input.contentType === 'image/jpeg' ? 'jpg' : input.contentType === 'image/png' ? 'png' : 'webp');
    const key = buildR2PhotoKey(input.purpose, { ...input, sha256: digest, extension: ext });
    const contentType = input.contentType ?? `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const stored = await this.r2.multipartPutObject({
      purpose: input.purpose,
      key,
      body: input.buffer,
      contentType,
      cacheControl: input.cacheControl ?? (input.purpose === 'processed' ? 'public, max-age=31536000, immutable' : 'private, max-age=0, no-store'),
      metadata: { ...input.metadata, 'original-sha256': digest, 'photo-role': input.photoRole, 'photo-set-id': input.photoSetId },
      storageClass: input.storageClass,
      sha256: digest,
    });
    return { ...stored, purpose: input.purpose, contentType };
  }

  async createThumbnail(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer).resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  }

  async presignedReviewUrl(purpose: Exclude<R2BucketPurpose, 'processed'>, key: string, ttlSeconds = 900): Promise<string> {
    return this.r2.presignedGetUrl(purpose, key, ttlSeconds);
  }

  async promoteReviewToEvidence(reviewKey: string, evidenceKey: string): Promise<void> {
    await this.r2.copyObject('review', reviewKey, 'evidence', evidenceKey, 'STANDARD_IA');
  }
}
