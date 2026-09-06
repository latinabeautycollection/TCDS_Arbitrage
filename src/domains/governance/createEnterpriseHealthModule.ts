import type { Pool } from "pg";
import type { Request, RequestHandler } from "express";
import { loadHealthWorkerConfig } from "./config/healthEnv";
import { ComponentHealthAggregationEngine } from "./engines/componentHealthAggregationEngine";
import { HealthClassificationEngine } from "./engines/healthClassificationEngine";
import type { AuthenticatedHealthPrincipal } from "./models/healthTypes";
import type { HealthLogger } from "./observability/healthLogger";
import { EnterpriseHealthMetrics, type HealthMetrics } from "./observability/healthMetrics";
import { HealthProbeAdapterRegistry } from "./providers/health/HealthProbeAdapterRegistry";
import { HttpHealthProbeAdapter } from "./providers/health/HttpHealthProbeAdapter";
import type { HealthProbeAdapter } from "./providers/health/HealthProbeAdapter";
import { HealthObservationRepository } from "./repositories/healthObservationRepository";
import { HealthQueryRepository } from "./repositories/healthQueryRepository";
import { HealthRegistryRepository } from "./repositories/healthRegistryRepository";
import { createHealthRoutes } from "./routes/healthRoutes";
import { HealthExpiryReconciliationService } from "./services/healthExpiryReconciliationService";
import { HealthObservationService } from "./services/healthObservationService";
import { HealthProbeService } from "./services/healthProbeService";
import { HealthRegistryService } from "./services/healthRegistryService";
import { EnterpriseHealthWorker } from "./workers/enterpriseHealthWorker";

export interface EnterpriseHealthModuleOptions {
  pool: Pool;
  authorizeRead: RequestHandler;
  authorizeWrite: RequestHandler;
  resolvePrincipal: (req: Request) => AuthenticatedHealthPrincipal;
  logger: HealthLogger;
  metrics?: HealthMetrics;
  adapters?: readonly HealthProbeAdapter[];
}

export function createEnterpriseHealthModule(options: EnterpriseHealthModuleOptions) {
  const config = loadHealthWorkerConfig();
  const metrics = options.metrics ?? new EnterpriseHealthMetrics();
  const registryRepository = new HealthRegistryRepository(options.pool);
  const observationRepository = new HealthObservationRepository();
  const queryRepository = new HealthQueryRepository(options.pool);
  const observationService = new HealthObservationService(
    options.pool,
    registryRepository,
    observationRepository,
    new HealthClassificationEngine(),
    new ComponentHealthAggregationEngine(),
    metrics,
    options.logger,
  );
  const registryService = new HealthRegistryService(registryRepository);
  const adapters = new HealthProbeAdapterRegistry().register(new HttpHealthProbeAdapter(config.httpAllowedHosts));
  for (const adapter of options.adapters ?? []) adapters.register(adapter);
  const probeService = new HealthProbeService(config, registryRepository, adapters, observationService, metrics, options.logger);
  const expiryService = new HealthExpiryReconciliationService(options.pool, observationRepository, new ComponentHealthAggregationEngine(), metrics, options.logger);
  const worker = new EnterpriseHealthWorker(config, probeService, expiryService, options.logger, metrics);
  const router = createHealthRoutes({
    authorizeRead: options.authorizeRead,
    authorizeWrite: options.authorizeWrite,
    resolvePrincipal: options.resolvePrincipal,
    observations: observationService,
    queries: queryRepository,
    metrics,
  });
  return { router, worker, registryService, observationService, probeService, expiryService, queryRepository, metrics };
}
