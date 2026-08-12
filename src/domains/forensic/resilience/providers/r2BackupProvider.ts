import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand,
  ListObjectsV2Command, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { ResilienceEnv } from '../config/resilienceEnv';

export class R2BackupProvider {
  private readonly client: S3Client;
  constructor(private readonly env: ResilienceEnv) {
    this.client = new S3Client({
      endpoint: env.R2_ENDPOINT, region: env.R2_REGION, forcePathStyle: true,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    });
  }

  async upload(bucket: string, key: string, path: string, metadata: Record<string,string>) {
    const result = await this.client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: createReadStream(path), Metadata: metadata,
    }));
    return { etag: result.ETag, versionId: result.VersionId };
  }

  async head(bucket: string, key: string) {
    return this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  }

  async replicate(primaryKey: string, secondaryKey: string) {
    return this.client.send(new CopyObjectCommand({
      Bucket: this.env.R2_FORENSIC_SECONDARY_BUCKET,
      Key: secondaryKey,
      CopySource: `${this.env.R2_FORENSIC_BACKUP_BUCKET}/${encodeURIComponent(primaryKey)}`,
      MetadataDirective: 'COPY',
    }));
  }

  async download(bucket: string, key: string, path: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) throw new Error('Object body missing');
    await pipeline(result.Body as Readable, createWriteStream(path, { mode: 0o600 }));
    return { etag: result.ETag, versionId: result.VersionId, metadata: result.Metadata ?? {} };
  }

  async verifyCopies(input: {
    primaryKey: string; secondaryKey: string; sha256: string; bytes: number;
    keyId: string; keyVersion: string; encryptedDataKey: string;
  }) {
    const [primary, secondary] = await Promise.all([
      this.head(this.env.R2_FORENSIC_BACKUP_BUCKET, input.primaryKey),
      this.head(this.env.R2_FORENSIC_SECONDARY_BUCKET, input.secondaryKey),
    ]);
    const required = {
      sha256: input.sha256, keyid: input.keyId, keyversion: input.keyVersion,
      encrypteddatakey: input.encryptedDataKey,
    };
    for (const [name, object] of [['primary', primary], ['secondary', secondary]] as const) {
      if (object.ContentLength !== input.bytes) throw new Error(`${name} byte count mismatch`);
      for (const [key, value] of Object.entries(required)) {
        if ((object.Metadata ?? {})[key] !== value) throw new Error(`${name} metadata mismatch: ${key}`);
      }
    }
    return {
      primaryVersionId: primary.VersionId, secondaryVersionId: secondary.VersionId,
      primaryEtag: primary.ETag, secondaryEtag: secondary.ETag,
    };
  }

  async inventory(bucket: string, prefix: string) {
    const rows: Array<{key:string; size:number; etag?:string}> = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const object of page.Contents ?? []) if (object.Key) rows.push({ key: object.Key, size: object.Size ?? 0, etag: object.ETag });
      token = page.NextContinuationToken;
    } while (token);
    return rows;
  }

  async remove(bucket: string, key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}
