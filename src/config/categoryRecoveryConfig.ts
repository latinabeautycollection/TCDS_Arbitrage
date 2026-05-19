export type CategoryRecoveryMode = 'preview' | 'apply' | 'rollback';
export type DecisionTarget = 'WATCH' | 'REJECT';

export interface CategoryRecoveryConfig {
  mode: CategoryRecoveryMode;
  batchSize: number;
  limit: number;
  minRecoveryConfidence: number;
  onlyDecisions: DecisionTarget[];
  processName: string;
  workerName: string;
  artifactDir: string;
  allowManualReviewRequeue: boolean;
}

export const categoryRecoveryConfig: CategoryRecoveryConfig = {
  mode: (process.env.CATEGORY_RECOVERY_MODE as CategoryRecoveryMode) ?? 'preview',
  batchSize: Number(process.env.CATEGORY_RECOVERY_BATCH_SIZE ?? 250),
  limit: Number(process.env.CATEGORY_RECOVERY_LIMIT ?? 500),
  minRecoveryConfidence: Number(process.env.CATEGORY_RECOVERY_MIN_CONFIDENCE ?? 0.72),
  onlyDecisions: ['WATCH', 'REJECT'],
  processName: 'candidate_category_recovery',
  workerName: 'categoryRecoveryWorker',
  artifactDir: process.env.CATEGORY_RECOVERY_ARTIFACT_DIR ?? '/srv/arb-system/artifacts/recovery',
  allowManualReviewRequeue: (process.env.CATEGORY_RECOVERY_ALLOW_MANUAL_REVIEW_REQUEUE ?? 'true') === 'true',
};
