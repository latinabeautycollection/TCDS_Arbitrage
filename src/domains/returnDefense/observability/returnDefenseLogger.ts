import pino from "pino";
export const returnDefenseLogger = pino({
  name: "domain8-return-defense",
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["req.headers.authorization", "*.buyerEmail", "*.address"],
    censor: "[REDACTED]",
  },
});
