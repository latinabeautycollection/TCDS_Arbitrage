import crypto from 'node:crypto';
import type { EvidenceType, ForensicEventType, ForensicEvidenceInput, ForensicEvidenceRecord } from '../contracts/acquisitionExecutionIntegrity';

export const REQUIRED_FORENSIC_EVENTS: ForensicEventType[] = [
  'SOURCE_CAPTURED',
  'PURCHASE_DECISION_CAPTURED',
  'ITEM_RECEIVED',
  'CONDITION_CAPTURED',
  'PACKAGED',
  'SHIPPING_LABEL_CREATED',
  'SHIPPED',
];

export function buildForensicEvidenceRecord(input: ForensicEvidenceInput): ForensicEvidenceRecord {
  validateForensicInput(input);
  const canonicalPayload = canonicalizeEvidencePayload(input);
  const hashSha256 = input.hashSha256 ?? sha256(canonicalPayload);
  return {
    listingId: input.listingId,
    eventType: input.eventType,
    evidenceType: input.evidenceType,
    storageUrl: input.storageUrl ?? null,
    rawText: input.rawText ?? null,
    rawJson: input.rawJson ?? null,
    hashSha256,
    actor: input.actor ?? null,
    correlationId: input.correlationId ?? null,
    metadata: input.metadata ?? {},
    createdAtIso: new Date().toISOString(),
  };
}

export function calculateForensicCompleteness(records: Array<Pick<ForensicEvidenceRecord, 'eventType' | 'evidenceType'>>): {
  completenessScore: number;
  presentEvents: ForensicEventType[];
  missingEvents: ForensicEventType[];
  serialEvidencePresent: boolean;
  shipmentEvidencePresent: boolean;
} {
  const present = new Set(records.map((record) => record.eventType));
  const missingEvents = REQUIRED_FORENSIC_EVENTS.filter((event) => !present.has(event));
  const presentEvents = REQUIRED_FORENSIC_EVENTS.filter((event) => present.has(event));
  const serialEvidencePresent = records.some((r) => ['SERIAL_NUMBER', 'IMEI', 'MAC_ADDRESS'].includes(r.evidenceType));
  const shipmentEvidencePresent = present.has('SHIPPING_LABEL_CREATED') && present.has('SHIPPED');
  const baseScore = presentEvents.length / REQUIRED_FORENSIC_EVENTS.length;
  const bonus = (serialEvidencePresent ? 0.08 : 0) + (shipmentEvidencePresent ? 0.05 : 0);
  return {
    completenessScore: round(clamp01(baseScore + bonus), 4),
    presentEvents,
    missingEvents,
    serialEvidencePresent,
    shipmentEvidencePresent,
  };
}

export function requiredEvidenceForCategory(categoryKey: string | null, estimatedSalePriceUsd: number): ForensicEventType[] {
  const category = categoryKey ?? '';
  const required = [...REQUIRED_FORENSIC_EVENTS];
  if (/phone|tablet|laptop|console|network|camera|lens/i.test(category) || estimatedSalePriceUsd >= 150) required.push('SERIAL_CAPTURED');
  if (estimatedSalePriceUsd >= 750) required.push('DELIVERED');
  return [...new Set(required)];
}

export function toForensicInsertSqlParams(record: ForensicEvidenceRecord): unknown[] {
  return [
    record.listingId,
    record.eventType,
    record.evidenceType,
    record.storageUrl,
    record.rawText,
    JSON.stringify(record.rawJson ?? {}),
    record.hashSha256,
    record.actor,
    record.correlationId,
    JSON.stringify(record.metadata),
  ];
}

export const INSERT_FORENSIC_CHAIN_SQL = `
insert into arb.acquisition_forensic_chain (
  listing_id,
  event_type,
  evidence_type,
  storage_url,
  raw_text,
  raw_json,
  hash_sha256,
  actor,
  correlation_id,
  metadata_json,
  created_at
)
values ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, now())
on conflict (listing_id, event_type, evidence_type, hash_sha256) do nothing
`;

function validateForensicInput(input: ForensicEvidenceInput): void {
  if (!isUuid(input.listingId)) throw new Error(`Invalid listingId for forensic evidence: ${input.listingId}`);
  if (!input.eventType) throw new Error('Missing forensic eventType');
  if (!input.evidenceType) throw new Error('Missing forensic evidenceType');
  if (!input.storageUrl && !input.rawText && !input.rawJson && !input.hashSha256) {
    throw new Error('Forensic evidence must include storageUrl, rawText, rawJson, or hashSha256');
  }
}

function canonicalizeEvidencePayload(input: ForensicEvidenceInput): string {
  return JSON.stringify({
    listingId: input.listingId,
    eventType: input.eventType,
    evidenceType: input.evidenceType,
    storageUrl: input.storageUrl ?? null,
    rawText: input.rawText ?? null,
    rawJson: sortObject(input.rawJson ?? {}),
    metadata: sortObject(input.metadata ?? {}),
  });
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortObject(v)]));
  }
  return value;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
