import { Pool } from 'pg';
import { R2Client } from '../providers/r2Client';
import type { R2BucketPurpose } from '../config/r2StorageConfig';

export interface RetentionRule {
  purpose: R2BucketPurpose;
  olderThanDays: number;
  action: 'delete' | 'transition_to_ia';
  maxObjectsPerRun?: number;
}

export class PhotoRetentionService {
  constructor(private readonly pool: Pool, private readonly r2 = new R2Client()) {}

  async deleteExpiredTempObjects(now = new Date()): Promise<number> {
    const res = await this.pool.query(`
      select id, storage_bucket, storage_key, storage_purpose
      from arb.product_photo_storage_objects
      where storage_status = 'ACTIVE'
        and retention_until is not null
        and retention_until < $1
        and storage_purpose in ('temp','deadletter','review')
      limit 1000
    `, [now]);
    let deleted = 0;
    for (const row of res.rows) {
      await this.r2.deleteObject(row.storage_purpose, row.storage_key);
      await this.pool.query(`update arb.product_photo_storage_objects set storage_status='DELETED', deleted_at=now() where id=$1`, [row.id]);
      deleted += 1;
    }
    return deleted;
  }

  async writeLifecycleRules(): Promise<void> {
    await this.r2.configureLifecycle('temp', undefined, 7);
    await this.r2.configureLifecycle('deadletter', undefined, 60);
    await this.r2.configureLifecycle('review', undefined, 180);
    await this.r2.configureLifecycle('originals', 180, 730);
    await this.r2.configureLifecycle('processed', 180, 730);
    await this.r2.configureLifecycle('evidence', 180, undefined);
    await this.r2.configureLifecycle('analytics', 30, undefined);
  }
}
