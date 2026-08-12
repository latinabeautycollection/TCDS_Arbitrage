import { z } from "zod";

const bool = (def: "true" | "false") => z.enum(["true", "false"]).default(def).transform(v => v === "true");

const schema = z.object({
  DOMAIN10_EMAIL_ENABLED: bool("false"),
  DOMAIN10_ENVIRONMENT: z.enum(["development","test","staging","production"]).default("production"),
  DATABASE_URL: z.string().min(1),

  M365_TENANT_ID: z.string().uuid(),
  M365_CLIENT_ID: z.string().uuid(),
  M365_AUTH_MODE: z.enum(["certificate","client_secret"]).default("certificate"),
  M365_CERTIFICATE_PATH: z.string().optional(),
  M365_CLIENT_SECRET: z.string().min(20).optional(),

  M365_ALERT_FROM: z.string().email().default("alerts@tcdsolutionsgroup.com"),
  M365_REPLY_TO: z.string().email().default("alerts@tcdsolutionsgroup.com"),
  M365_ALLOWED_SENDER: z.string().email().default("alerts@tcdsolutionsgroup.com"),
  M365_GRAPH_BASE_URL: z.literal("https://graph.microsoft.com/v1.0"),

  DOMAIN10_EMAIL_MAX_RECIPIENTS_PER_MESSAGE: z.coerce.number().int().min(1).max(500).default(100),
  DOMAIN10_EMAIL_MAX_RECIPIENTS_PER_NOTIFICATION: z.coerce.number().int().min(1).max(10000).default(1000),
  DOMAIN10_EMAIL_MAX_SUBMISSIONS_PER_MINUTE: z.coerce.number().int().min(1).max(30).default(20),
  DOMAIN10_EMAIL_BROADCAST_MODE: z.enum(["TO","BCC"]).default("BCC"),

  DOMAIN10_EMAIL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  DOMAIN10_EMAIL_LEASE_SECONDS: z.coerce.number().int().min(30).max(600).default(90),
  DOMAIN10_EMAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  DOMAIN10_EMAIL_BASE_RETRY_MS: z.coerce.number().int().min(1000).default(30000),
  DOMAIN10_EMAIL_MAX_RETRY_MS: z.coerce.number().int().min(10000).default(1800000),
  DOMAIN10_EMAIL_BATCH_SIZE: z.coerce.number().int().min(1).max(30).default(10),
  DOMAIN10_EMAIL_MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(5_000_000).default(1_000_000),
  DOMAIN10_EMAIL_MAX_SUBJECT_LENGTH: z.coerce.number().int().min(20).max(255).default(180),
  LOG_LEVEL: z.string().default("info")
}).superRefine((v, ctx) => {
  if (v.M365_ALERT_FROM.toLowerCase() !== v.M365_ALLOWED_SENDER.toLowerCase()) {
    ctx.addIssue({code:"custom",path:["M365_ALERT_FROM"],message:"Sender is not the approved dedicated mailbox"});
  }
  if (v.DOMAIN10_ENVIRONMENT === "production" && v.M365_AUTH_MODE !== "certificate") {
    ctx.addIssue({code:"custom",path:["M365_AUTH_MODE"],message:"Production requires certificate authentication"});
  }
  if (v.M365_AUTH_MODE === "certificate" && !v.M365_CERTIFICATE_PATH) {
    ctx.addIssue({code:"custom",path:["M365_CERTIFICATE_PATH"],message:"Certificate path is required"});
  }
  if (v.M365_AUTH_MODE === "client_secret" && !v.M365_CLIENT_SECRET) {
    ctx.addIssue({code:"custom",path:["M365_CLIENT_SECRET"],message:"Client secret is required"});
  }
});

export type EmailEnv = z.infer<typeof schema>;
let cache: EmailEnv | undefined;

export function emailEnv(): EmailEnv {
  if (cache) return cache;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) throw new Error(`Domain 10 email configuration invalid: ${parsed.error.message}`);
  cache = parsed.data;
  return cache;
}
