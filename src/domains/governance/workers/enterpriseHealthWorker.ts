import type { HealthWorkerConfig } from "../config/healthEnv";
import type { HealthLogger } from "../observability/healthLogger";
import type { HealthMetrics } from "../observability/healthMetrics";
import { HealthExpiryReconciliationService } from "../services/healthExpiryReconciliationService";
import { HealthProbeService } from "../services/healthProbeService";

export class EnterpriseHealthWorker {
  private stopped = true;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly config: HealthWorkerConfig,
    private readonly probes: HealthProbeService,
    private readonly expiry: HealthExpiryReconciliationService,
    private readonly logger: HealthLogger,
    private readonly metrics: HealthMetrics,
  ) {}

  start(): void { if (this.stopped) { this.stopped = false; void this.tick(); } }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      const [claimed, reconciled] = await Promise.all([
        this.probes.runDueBatch(),
        this.expiry.reconcile(this.config.claimLimit),
      ]);
      if (claimed || reconciled) this.logger.info("domain11b.health.batch_complete", { claimed, reconciled, workerId: this.config.workerId, metrics: this.metrics.snapshot() });
    } catch (error) {
      this.logger.error("domain11b.health.batch_failed", { workerId: this.config.workerId, errorName: error instanceof Error ? error.name : "UnknownError" });
    } finally {
      if (!this.stopped) { this.timer = setTimeout(() => void this.tick(), this.config.pollIntervalMs); (this.timer as { unref?: () => void }).unref?.(); }
    }
  }
}
