import type { Pool } from 'pg';
import type { Router } from 'express';
import { Router as createRouter } from 'express';
import type { ForensicLogger } from './models/orchestrationTypes';
import { ForensicOrchestrationRepository } from
  './repositories/forensicOrchestrationRepository';
import { ArbProcessRepository } from './repositories/arbProcessRepository';
import { ForensicChainService } from './services/forensicChainService';
import {
  createForensicChainRouter,
  forensicErrorMiddleware,
} from './routes/forensicChainRoutes';
import { createWarehouseForensicModule } from
  './warehouse/warehouseForensicModule';
import { ArbProcessRunAdapter } from
  './warehouse/adapters/arbProcessRunAdapter';
import { createShippingCustodyModule } from
  './shipping/shippingCustodyModule';
import { createDeliveryEvidenceModule } from
  './delivery/deliveryEvidenceModule';
import { requireForensicAuthenticationSession } from
  './auth/forensicAuthentication';
import { attachForensicPrincipal } from
  './warehouse/auth/warehouseIdentityPrincipalAdapter';
import { attachCorrelationId } from '../../lib/http/correlationId';

export function createDomain7ForensicModule(
  pool: Pool,
  logger: ForensicLogger,
): {
  router: Router;
  errorMiddleware: typeof forensicErrorMiddleware;
} {
  const router = createRouter();

  const orchestrationRepository = new ForensicOrchestrationRepository(pool);
  const processRepository = new ArbProcessRepository(pool);
  const chainService = new ForensicChainService(
    orchestrationRepository,
    processRepository,
    logger,
  );
  const warehouse = createWarehouseForensicModule(pool);
  const processRuns = new ArbProcessRunAdapter(pool);
  const shipping = createShippingCustodyModule(pool, processRuns);
  const delivery = createDeliveryEvidenceModule(pool);

  router.use(requireForensicAuthenticationSession);
  router.use(attachForensicPrincipal(pool));
  router.use(attachCorrelationId);

  router.use(createForensicChainRouter(chainService, orchestrationRepository));
  router.use('/warehouse', warehouse.router);
  router.use('/shipping/custody', shipping.router);
  router.use('/delivery', delivery.router);

  return { router, errorMiddleware: forensicErrorMiddleware };
}
