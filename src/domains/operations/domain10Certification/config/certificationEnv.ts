import { z } from "zod";

const schema=z.object({
  DOMAIN10_CERTIFICATION_MAX_WINDOW_DAYS:z.coerce.number().int().min(1).max(31).default(7),
  DOMAIN10_CERTIFICATION_DEFAULT_PROFILE:z.string().regex(/^[A-Z0-9_]+$/).default("DOMAIN10_ENTERPRISE_RELEASE"),
  DOMAIN10_CERTIFICATION_DEFAULT_PROFILE_VERSION:z.coerce.number().int().positive().default(2)
});

export type Domain10CertificationEnv=z.infer<typeof schema>;
let cached:Domain10CertificationEnv|undefined;

export function domain10CertificationEnv():Domain10CertificationEnv{
  if(cached) return cached;
  const parsed=schema.safeParse(process.env);
  if(!parsed.success){
    throw new Error(`Domain 10F certification environment invalid: ${parsed.error.message}`);
  }
  cached=parsed.data;
  return cached;
}
