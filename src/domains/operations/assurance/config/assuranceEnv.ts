import { z } from "zod";

const bool = (def: "true" | "false") => z.enum(["true","false"]).default(def).transform((v:string)=>v==="true");

const schema=z.object({
  DOMAIN10_ASSURANCE_ENABLED:bool("false"),
  DOMAIN10_ASSURANCE_EVALUATION_BATCH_SIZE:z.coerce.number().int().min(1).max(100).default(25),
  DOMAIN10_ASSURANCE_EVALUATION_LEASE_SECONDS:z.coerce.number().int().min(30).max(900).default(180),
  DOMAIN10_ASSURANCE_EMISSION_BATCH_SIZE:z.coerce.number().int().min(1).max(100).default(25),
  DOMAIN10_ASSURANCE_EMISSION_LEASE_SECONDS:z.coerce.number().int().min(30).max(900).default(180),
  DOMAIN10_ASSURANCE_MAX_EMISSION_ATTEMPTS:z.coerce.number().int().min(1).max(50).default(10),
  DOMAIN10_ASSURANCE_EMISSION_RETRY_MS:z.coerce.number().int().min(1000).max(3600000).default(30000)
});

export type AssuranceEnv=z.infer<typeof schema>;
let cached:AssuranceEnv|undefined;

export function assuranceEnv():AssuranceEnv{
  if(cached) return cached;
  const parsed=schema.safeParse(process.env);
  if(!parsed.success){
    throw new Error(`Domain 10E assurance environment invalid: ${parsed.error.message}`);
  }
  cached=parsed.data;
  return cached;
}
