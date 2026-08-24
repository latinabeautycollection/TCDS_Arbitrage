import "dotenv/config";
import { pool } from "../domains/operations/repositories/db";
import {
  configureDomain10Runtime,
  type Domain10Runtime,
} from "../domains/operations/infrastructure/operationsRuntime";
import { configureDeliveryProviderRegistry } from "../domains/operations/delivery/ports/deliveryProviderRegistry";
import { adaptExistingMicrosoftGraphSender } from "../domains/operations/delivery/adapters/microsoftGraphDeliveryAdapter";
import {
  adaptExistingTelnyxSender,
  type ExistingTelnyxSender,
} from "../domains/operations/delivery/adapters/telnyxDeliveryAdapter";
import { MicrosoftGraphEmailProvider } from "../domains/operations/providers/microsoftGraphEmailProvider";
import { runDeliveryOrchestrationBatch } from "../domains/operations/delivery/workers/deliveryOrchestrationWorker";
import { runDeliveryReconciliationBatch } from "../domains/operations/delivery/workers/deliveryReconciliationWorker";

const logger: Domain10Runtime["logger"] = {
  info: (m, c) => console.log(JSON.stringify({ lvl: "info", m, ...(c ?? {}) })),
  warn: (m, c) => console.warn(JSON.stringify({ lvl: "warn", m, ...(c ?? {}) })),
  error: (m, c) => console.error(JSON.stringify({ lvl: "error", m, ...(c ?? {}) })),
};
const metrics: Domain10Runtime["metrics"] = { increment: () => {}, observe: () => {}, gauge: () => {} };
const tracer: Domain10Runtime["tracer"] = { startSpan: () => ({ setAttribute: () => {}, end: () => {} }) };
configureDomain10Runtime({ pool, logger, metrics, tracer });

const TELNYX_KEY = process.env.TELNYX_API_KEY ?? "";
const SMS_FROM = process.env.DOMAIN10_SMS_FROM ?? "+15715160419";
const telnyxSender: ExistingTelnyxSender = {
  async sendOperationalMessage({ to, text, tags }) {
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${TELNYX_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SMS_FROM, to, text, tags }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { id?: string; to?: Array<{ status?: string }> };
    };
    return {
      httpStatus: res.status,
      ...(body?.data?.id ? { messageId: body.data.id } : {}),
      ...(res.headers.get("x-request-id") ? { providerRequestId: res.headers.get("x-request-id")! } : {}),
      status: body?.data?.to?.[0]?.status ?? "queued",
    };
  },
};

configureDeliveryProviderRegistry({
  email: adaptExistingMicrosoftGraphSender(new MicrosoftGraphEmailProvider()),
  sms: adaptExistingTelnyxSender(telnyxSender),
});

let stopping = false;
const guard = (name: string, fn: () => Promise<number>) => {
  let running = false;
  return async () => {
    if (running || stopping) return;
    running = true;
    try {
      const n = await fn();
      if (n > 0) logger.info("batch processed", { name, n });
    } catch (e) {
      logger.error("batch error", { name, err: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };
};
const timers = [
  setInterval(guard("delivery:EMAIL", () => runDeliveryOrchestrationBatch("EMAIL")), 5000),
  setInterval(guard("delivery:SMS", () => runDeliveryOrchestrationBatch("SMS")), 5000),
  setInterval(guard("reconciliation", () => runDeliveryReconciliationBatch()), 30000),
];
logger.info("domain10 delivery bootstrap started", { from: SMS_FROM });
const shutdown = (sig: string) => { logger.info("shutting down", { sig }); stopping = true; timers.forEach(clearInterval); setTimeout(() => process.exit(0), 2000); };
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
