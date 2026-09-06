import { trace,context } from '@opentelemetry/api';
import type { TraceContext } from '../models/observabilityTypes';

export function getActiveOpenTelemetryContext():TraceContext{
  const span=trace.getSpan(context.active());
  if(!span)return {};
  const c=span.spanContext();
  return {traceId:c.traceId,spanId:c.spanId,traceFlags:c.traceFlags,traceState:c.traceState?.serialize()};
}
