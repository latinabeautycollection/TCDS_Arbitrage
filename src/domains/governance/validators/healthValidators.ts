import { HEALTH_OUTCOMES } from "../constants/healthConstants";
import type { AuthenticatedHealthPrincipal, PushHealthSignal } from "../models/healthTypes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE = /(secret|password|passwd|token|authorization|credential|api[_-]?key|private[_-]?key|client[_-]?secret)/i;

export function assertUuid(value: string, field: string): void {
  if (!UUID.test(value)) throw new Error(`${field} must be a UUID`);
}

export function parseCorrelationId(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (Array.isArray(value)) throw new Error("x-correlation-id must contain exactly one UUID");
  const normalized = String(value).trim();
  assertUuid(normalized, "x-correlation-id");
  return normalized;
}

export function assertHealthPrincipal(value: AuthenticatedHealthPrincipal): AuthenticatedHealthPrincipal {
  const principalId = value.principalId?.trim();
  if (!principalId || principalId.length > 256) throw new Error("authenticated principalId is required and <=256 chars");
  if (value.producerComponentId) assertUuid(value.producerComponentId, "producerComponentId");
  return { principalId, producerComponentId: value.producerComponentId };
}

export function assertNoSensitiveKeys(value: unknown, path = "configuration"): void {
  if (Array.isArray(value)) return value.forEach((v, i) => assertNoSensitiveKeys(v, `${path}[${i}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE.test(key)) throw new Error(`${path}.${key} may not contain secret material; use secretReference`);
    assertNoSensitiveKeys(child, `${path}.${key}`);
  }
}

export function parsePushHealthSignal(input: unknown): PushHealthSignal {
  if (!input || typeof input !== "object") throw new Error("body must be an object");
  const v = input as Record<string, unknown>;
  const definitionId = String(v.definitionId ?? "");
  const componentId = String(v.componentId ?? "");
  const sourceEventId = String(v.sourceEventId ?? "").trim();
  const outcome = String(v.outcome ?? "") as PushHealthSignal["outcome"];
  assertUuid(definitionId, "definitionId");
  assertUuid(componentId, "componentId");
  if (!sourceEventId || sourceEventId.length > 256) throw new Error("sourceEventId is required and <=256 chars");
  if (!HEALTH_OUTCOMES.includes(outcome)) throw new Error("invalid outcome");
  const observedAt = new Date(String(v.observedAt ?? ""));
  if (Number.isNaN(observedAt.getTime())) throw new Error("observedAt must be ISO timestamp");
  if (observedAt.getTime() > Date.now() + 60_000) throw new Error("observedAt exceeds allowed future clock skew");
  const latencyMs = v.latencyMs == null ? undefined : Number(v.latencyMs);
  if (latencyMs != null && (!Number.isInteger(latencyMs) || latencyMs < 0 || latencyMs > 120000)) throw new Error("invalid latencyMs");
  const evidence = v.evidence == null ? {} : v.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) throw new Error("evidence must be an object");
  assertNoSensitiveKeys(evidence, "evidence");
  if (Buffer.byteLength(JSON.stringify(evidence), "utf8") > 65_536) throw new Error("evidence exceeds 64 KiB");
  return { definitionId, componentId, sourceEventId, outcome, observedAt, latencyMs, evidence: evidence as Record<string, unknown> };
}
