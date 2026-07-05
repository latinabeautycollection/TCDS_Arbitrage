import path from 'path';
import { randomUUID } from 'crypto';
import type { R2BucketPurpose } from '../config/r2StorageConfig';

export interface PhotoKeyInput {
  env?: string;
  candidateId?: string | number | null;
  listingId?: string | null;
  sourceListingNormalizedId?: string | number | null;
  photoSetId?: string | null;
  photoRole?: string;
  index?: number;
  sha256?: string;
  extension?: string;
}

function clean(value: unknown, fallback = 'unknown'): string {
  const s = String(value ?? fallback).trim().toLowerCase();
  return s.replace(/[^a-z0-9._=-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

export function buildR2PhotoKey(purpose: R2BucketPurpose, input: PhotoKeyInput): string {
  const env = clean(input.env ?? process.env.NODE_ENV ?? 'prod');
  const candidate = clean(input.candidateId, 'na');
  const listing = clean(input.listingId ?? input.sourceListingNormalizedId, 'na');
  const set = clean(input.photoSetId ?? randomUUID());
  const role = clean(input.photoRole ?? purpose);
  const idx = String(input.index ?? 1).padStart(3, '0');
  const digest = clean(input.sha256?.slice(0, 16) ?? randomUUID().replace(/-/g, '').slice(0, 16));
  const ext = clean((input.extension ?? 'webp').replace(/^\./, ''));
  return path.posix.join(`env=${env}`, `candidate_id=${candidate}`, `listing_id=${listing}`, `photo_set_id=${set}`, purpose, `${idx}_${role}_${digest}.${ext}`);
}

export function publicR2Url(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${encodeURI(key).replace(/%2F/g, '/')}`;
}
