import { z } from "zod";

const bool = (def: "true" | "false") => z.enum(["true","false"]).default(def).transform((v:string)=>v==="true");

const schema=z.object({
  DOMAIN10_INCIDENTS_ENABLED:bool("false"),
  DOMAIN10_INCIDENT_ACTIVATION_BATCH_SIZE:z.coerce.number().int().min(1).max(100).default(20),
  DOMAIN10_INCIDENT_ACTIVATION_LEASE_SECONDS:z.coerce.number().int().min(30).max(600).default(120),
  DOMAIN10_ACK_DEADLINE_BATCH_SIZE:z.coerce.number().int().min(1).max(100).default(25),
  DOMAIN10_ACK_DEADLINE_LEASE_SECONDS:z.coerce.number().int().min(30).max(600).default(120),
  DOMAIN10_ESCALATION_BATCH_SIZE:z.coerce.number().int().min(1).max(100).default(20),
  DOMAIN10_ESCALATION_LEASE_SECONDS:z.coerce.number().int().min(30).max(600).default(120),
  DOMAIN10_ESCALATION_SETTLEMENT_BATCH_SIZE:z.coerce.number().int().min(1).max(100).default(25),
  DOMAIN10_ESCALATION_SETTLEMENT_LEASE_SECONDS:z.coerce.number().int().min(30).max(600).default(120),
  DOMAIN10_INCIDENT_COMMAND_MAX_AGE_SECONDS:z.coerce.number().int().min(60).max(86400).default(3600)
});

export type IncidentEnv=z.infer<typeof schema>;
let cached:IncidentEnv|undefined;
export function incidentEnv():IncidentEnv{
  if(cached) return cached;
  const parsed=schema.safeParse(process.env);
  if(!parsed.success) throw new Error(`Domain 10D incident environment invalid: ${parsed.error.message}`);
  cached=parsed.data;
  return cached;
}
