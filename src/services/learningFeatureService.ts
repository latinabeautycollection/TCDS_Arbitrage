import { withTx } from '../db/tx';
import { LearningFeatureRepository } from '../repositories/learningFeatureRepository';

export class LearningFeatureService {
  async compute(input: {
    processRunId: number;
    entityType: string;
    entityPk: string;
    sourceForensicEventId?: number | null;
    features: Array<{ featureName: string; featureValue: unknown }>;
  }) {
    return withTx(async (client) => {
      const repo = new LearningFeatureRepository(client);
      const created = [];
      for (const feature of input.features) {
        created.push(
          await repo.insert({
            processRunId: input.processRunId,
            entityType: input.entityType,
            entityPk: input.entityPk,
            featureName: feature.featureName,
            featureValue: feature.featureValue,
            sourceForensicEventId: input.sourceForensicEventId ?? null
          })
        );
      }
      return created;
    });
  }
}
