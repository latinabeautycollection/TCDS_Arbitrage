import { domain10Runtime } from "../infrastructure/operationsRuntime";
import type { OperationalEventEnvelope } from "../models/eventTypes";

export interface IngestResult {
  eventId: string;
  inserted: boolean;
}

export async function ingestOperationalEvent(
  event: OperationalEventEnvelope,
  eventContractHash: string
): Promise<IngestResult> {
  const r = await domain10Runtime().pool.query<{event_id:string; inserted:boolean}>(`
    SELECT event_id,inserted
    FROM operations.ingest_operational_event(
      $1,$2,$3,$4::timestamptz,$5,$6,$7,$8,$9::uuid,$10::uuid,$11,$12::uuid,
      $13,$14,$15::jsonb,$16
    )
  `, [
    event.sourceKey,
    event.sourceEventId,
    event.eventType,
    event.occurredAt,
    event.severity,
    event.classification,
    event.subjectType ?? null,
    event.subjectId ?? null,
    event.correlationId,
    event.causationId ?? null,
    event.traceId ?? null,
    event.requestId ?? null,
    event.schemaVersion,
    event.producer,
    JSON.stringify(event.payload),
    eventContractHash
  ]);

  const row = r.rows[0];
  if (!row) throw new Error("ingest_operational_event returned no row");
  return {eventId:row.event_id, inserted:row.inserted};
}
