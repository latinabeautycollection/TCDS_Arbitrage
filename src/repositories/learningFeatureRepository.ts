import { PoolClient } from 'pg';

export interface InsertLearningFeatureInput {
  processRunId: string | number;

  forensicEventId?: number | null;
  sourceForensicEventId?: number | null;

  entityType: string;
  entityPk: string;

  featureGroup?: string | null;

  featureName: string;

  featureValueJson?: Record<string, unknown> | null;
  featureValue?: unknown;
}

export class LearningFeatureRepository {
  constructor(private readonly client: PoolClient) {}

  async insert(input: InsertLearningFeatureInput) {
    const normalizedProcessRunId = this.normalizeProcessRunId(input.processRunId);
    const normalizedForensicEventId =
      input.forensicEventId ?? input.sourceForensicEventId ?? null;
    const normalizedFeatureGroup = this.normalizeFeatureGroup(input.featureGroup);
    const normalizedFeatureValue = this.normalizeFeatureValue(
      input.featureValueJson,
      input.featureValue
    );

    const { rows } = await this.client.query(
      `
      insert into arb.learning_features (
        process_run_id,
        forensic_event_id,
        entity_type,
        entity_pk,
        feature_group,
        feature_name,
        feature_value_json,
        created_at
      )
      values (
        $1,$2,$3,$4,$5,$6,$7::jsonb,now()
      )
      returning *
      `,
      [
        normalizedProcessRunId,
        normalizedForensicEventId,
        input.entityType,
        input.entityPk,
        normalizedFeatureGroup,
        input.featureName,
        JSON.stringify(normalizedFeatureValue)
      ]
    );

    return rows[0];
  }

  async bulkInsert(rowsToInsert: InsertLearningFeatureInput[]) {
    const results = [];
    for (const row of rowsToInsert) {
      results.push(await this.insert(row));
    }
    return results;
  }

  async insertMany(rowsToInsert: InsertLearningFeatureInput[]) {
    return this.bulkInsert(rowsToInsert);
  }

  async getByEntity(entityType: string, entityPk: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.learning_features
      where entity_type = $1
        and entity_pk = $2
      order by id asc
      `,
      [entityType, entityPk]
    );

    return rows;
  }

  async getByRunId(processRunId: string | number) {
    const normalizedProcessRunId = this.normalizeProcessRunId(processRunId);

    const { rows } = await this.client.query(
      `
      select *
      from arb.learning_features
      where process_run_id = $1
      order by id asc
      `,
      [normalizedProcessRunId]
    );

    return rows;
  }

  async getForRun(processRunId: string | number) {
    return this.getByRunId(processRunId);
  }

  async getByRunAndEntity(
    processRunId: string | number,
    entityType: string,
    entityPk: string
  ) {
    const normalizedProcessRunId = this.normalizeProcessRunId(processRunId);

    const { rows } = await this.client.query(
      `
      select *
      from arb.learning_features
      where process_run_id = $1
        and entity_type = $2
        and entity_pk = $3
      order by id asc
      `,
      [normalizedProcessRunId, entityType, entityPk]
    );

    return rows;
  }


  async getByEntityAndGroup(
    entityType: string,
    entityPk: string,
    featureGroup: string
  ) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.learning_features
      where entity_type = $1
        and entity_pk = $2
        and feature_group = $3
      order by id asc
      `,
      [entityType, entityPk, featureGroup]
    );

    return rows;
  }

  async getLatestFeature(
    entityType: string,
    entityPk: string,
    featureGroup: string,
    featureName: string
  ) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.learning_features
      where entity_type = $1
        and entity_pk = $2
        and feature_group = $3
        and feature_name = $4
      order by id desc
      limit 1
      `,
      [entityType, entityPk, featureGroup, featureName]
    );

    return rows[0] ?? null;
  }

  private normalizeProcessRunId(value: string | number): string {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    throw new Error('LearningFeatureRepository.insert requires a valid processRunId');
  }

  private normalizeFeatureGroup(featureGroup?: string | null): string {
    if (typeof featureGroup === 'string' && featureGroup.trim().length > 0) {
      return featureGroup.trim();
    }

    return 'general';
  }

  private normalizeFeatureValue(
    featureValueJson?: Record<string, unknown> | null,
    featureValue?: unknown
  ): Record<string, unknown> {
    if (
      featureValueJson &&
      typeof featureValueJson === 'object' &&
      !Array.isArray(featureValueJson)
    ) {
      return featureValueJson;
    }

    if (
      featureValue &&
      typeof featureValue === 'object' &&
      !Array.isArray(featureValue)
    ) {
      return featureValue as Record<string, unknown>;
    }

    if (featureValue !== undefined) {
      return { value: featureValue };
    }

    return {};
  }
}
