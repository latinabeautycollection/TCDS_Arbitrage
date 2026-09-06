import { HealthError } from "../../errors/HealthError";
import type { HealthCheckKind } from "../../models/healthTypes";
import type { HealthProbeAdapter } from "./HealthProbeAdapter";

export class HealthProbeAdapterRegistry {
  private readonly adapters = new Map<HealthCheckKind, HealthProbeAdapter>();

  register(adapter: HealthProbeAdapter): this {
    if (this.adapters.has(adapter.kind)) throw new HealthError("HEALTH_ADAPTER_DUPLICATE", `Duplicate adapter for ${adapter.kind}`, false);
    this.adapters.set(adapter.kind, adapter);
    return this;
  }

  get(kind: HealthCheckKind): HealthProbeAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) throw new HealthError("HEALTH_ADAPTER_MISSING", `No health adapter registered for ${kind}`, false);
    return adapter;
  }
}
