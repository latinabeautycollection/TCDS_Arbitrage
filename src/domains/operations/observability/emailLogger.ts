import pino from "pino";
import { emailEnv } from "../config/emailEnv";

export const emailLogger = pino({
  name: "domain10-email",
  level: emailEnv().LOG_LEVEL,
  redact: {
    paths: [
      "M365_CLIENT_SECRET", "*.M365_CLIENT_SECRET", "*.accessToken", "*.authorization",
      "*.htmlBody", "*.textBody", "*.variables"
    ],
    censor: "[REDACTED]"
  }
});
