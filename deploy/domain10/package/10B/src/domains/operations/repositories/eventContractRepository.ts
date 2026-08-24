import { domain10Runtime } from "../infrastructure/operationsRuntime";
import type { EventContractVersion } from "../models/decisionTypes";

export async function getEventContract(
  eventType: string,
  schemaVersion: number,
  occurredAt: string
): Promise<EventContractVersion | null> {
  const r = await domain10Runtime().pool.query<{
    event_type: string;
    schema_version: number;
    lifecycle_state: "DRAFT" | "FROZEN" | "RETIRED";
    json_schema: Record<string, unknown>;
    schema_hash: string;
    required_top_level_fields: string[];
    top_level_types: Record<string, string>;
  }>(`
    SELECT event_type,schema_version,lifecycle_state,json_schema,schema_hash,
           required_top_level_fields,top_level_types
    FROM operations.event_contract_versions
    WHERE event_type=$1
      AND schema_version=$2
      AND lifecycle_state IN ('FROZEN','RETIRED')
      AND (effective_from IS NULL OR effective_from <= $3::timestamptz)
      AND (effective_until IS NULL OR effective_until > $3::timestamptz)
  `, [eventType, schemaVersion, occurredAt]);

  const row = r.rows[0];
  if (!row) return null;
  return {
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    lifecycleState: row.lifecycle_state,
    jsonSchema: row.json_schema,
    schemaHash: row.schema_hash,
    requiredTopLevelFields: row.required_top_level_fields,
    topLevelTypes: row.top_level_types
  };
}
