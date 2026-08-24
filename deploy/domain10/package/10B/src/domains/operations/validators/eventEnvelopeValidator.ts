import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { z } from "zod";
import { operationsEnv } from "../config/operationsEnv";
import type { EventContractVersion } from "../models/decisionTypes";
import type { OperationalEventEnvelope } from "../models/eventTypes";
import { OperationsDecisionError } from "../errors/OperationsDecisionError";

const envelopeSchema = z.object({
  sourceKey: z.string().regex(/^[A-Z0-9_]+$/).max(100),
  sourceEventId: z.string().min(1).max(200),
  eventType: z.string().regex(/^[A-Z0-9_]+$/).max(100),
  occurredAt: z.string().datetime({offset:true}),
  severity: z.enum(["INFORMATIONAL","NOTICE","WARNING","HIGH","CRITICAL","EMERGENCY"]),
  classification: z.enum(["PUBLIC","INTERNAL","CONFIDENTIAL","RESTRICTED"]),
  subjectType: z.string().max(100).optional(),
  subjectId: z.string().max(200).optional(),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().optional(),
  traceId: z.string().max(64).optional(),
  requestId: z.string().uuid().optional(),
  schemaVersion: z.number().int().positive(),
  producer: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown())
}).strict();

const ajv = new Ajv({
  allErrors:true,
  strict:true,
  removeAdditional:false,
  coerceTypes:false,
  useDefaults:false
});
addFormats(ajv);

const validatorCache = new Map<string, ValidateFunction>();

export function validateEnvelope(input:unknown):OperationalEventEnvelope{
  const parsed=envelopeSchema.safeParse(input);
  if(!parsed.success){
    throw new OperationsDecisionError(
      `Operational event envelope invalid: ${parsed.error.message}`,
      "EVENT_SCHEMA_INVALID",false
    );
  }

  const env=operationsEnv();
  const bytes=Buffer.byteLength(JSON.stringify(parsed.data.payload),"utf8");
  if(bytes>env.DOMAIN10_EVENT_MAX_PAYLOAD_BYTES){
    throw new OperationsDecisionError(
      `Operational event payload exceeds ${env.DOMAIN10_EVENT_MAX_PAYLOAD_BYTES} bytes`,
      "EVENT_SCHEMA_INVALID",false
    );
  }

  const now=Date.now();
  const occurred=Date.parse(parsed.data.occurredAt);
  if(occurred>now+env.DOMAIN10_EVENT_MAX_CLOCK_SKEW_SECONDS*1000){
    throw new OperationsDecisionError(
      "Operational event occurred_at is unreasonably in the future",
      "EVENT_SCHEMA_INVALID",false
    );
  }
  return parsed.data;
}

export function validatePayloadAgainstContract(
  event:OperationalEventEnvelope,
  contract:EventContractVersion
):void{
  const key=`${contract.eventType}:${contract.schemaVersion}:${contract.schemaHash}`;
  let validate=validatorCache.get(key);
  if(!validate){
    validate=ajv.compile(contract.jsonSchema);
    validatorCache.set(key,validate);
  }
  if(!validate(event.payload)){
    throw new OperationsDecisionError(
      `Payload failed frozen ${event.eventType} schema v${event.schemaVersion}: ${ajv.errorsText(validate.errors,{separator:"; "})}`,
      "EVENT_SCHEMA_INVALID",false
    );
  }
}
