
export interface GateFeatureProjector {
  project(
    gateStage: string,
    authoritativeSources: Array<Record<string, unknown>>,
  ): Record<string, unknown>;
}

/**
 * Projection is deterministic and must never invent source facts.
 * Each production implementation maps only known source columns from the
 * frozen Slice 8B source rows into the scalar feature schema.
 */
export class AuthoritativeFactProjectionService implements GateFeatureProjector {
  public project(
    gateStage: string,
    authoritativeSources: Array<Record<string, unknown>>,
  ): Record<string, unknown> {
    return {
      gate_stage: gateStage,
      authoritative_sources: authoritativeSources,
      source_count: authoritativeSources.length,
    };
  }
}
