import { trace } from "@opentelemetry/api";
export const emailTracer = trace.getTracer("tcds.domain10.email", "1.0.0");
