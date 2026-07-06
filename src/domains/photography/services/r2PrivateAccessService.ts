import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Pool } from 'pg';
import { R2StorageOptimizationRepository } from '../repositories/r2StorageOptimizationRepository';

export class R2PrivateAccessService {
  private readonly repo: R2StorageOptimizationRepository;
  constructor(private readonly s3: S3Client, pool: Pool) { this.repo = new R2StorageOptimizationRepository(pool); }

  async createSignedReviewUrl(input: { bucketName: string; objectKey: string; actorId?: string; actorName?: string; purpose?: 'review' | 'evidence' | 'download' | 'thumbnail' | 'debug' | 'other'; expiresSeconds?: number; requestId?: string; }): Promise<string> {
    const expiresIn = Math.min(input.expiresSeconds ?? 900, 3600);
    const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: input.bucketName, Key: input.objectKey }), { expiresIn });
    await this.repo.insertPrivateAccessAudit({ requestId: input.requestId, bucketName: input.bucketName, objectKey: input.objectKey, accessPurpose: input.purpose ?? 'review', actorType: 'user', actorId: input.actorId, actorName: input.actorName, allowed: true, statusCode: 200, signedUrlExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() });
    return url;
  }
}
