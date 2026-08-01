import type { Pool } from 'pg';
import type { Router } from 'express';
import { WarehouseForensicRepository } from './repositories/warehouseForensicRepository';
import { ArbProcessRunAdapter } from './adapters/arbProcessRunAdapter';
import { WarehouseForensicService } from './services/warehouseForensicService';
import { createWarehouseForensicRouter } from './routes/warehouseForensicRoutes';
import { checkWarehouseForensicReadiness } from './observability/warehouseForensicReadiness';

export interface WarehouseForensicModule {
  router: Router;
  service: WarehouseForensicService;
  readiness: () => Promise<ReturnType<typeof checkWarehouseForensicReadiness> extends Promise<infer T> ? T : never>;
}

export function createWarehouseForensicModule(pool:Pool):WarehouseForensicModule{
  const repository=new WarehouseForensicRepository(pool);
  const processRuns=new ArbProcessRunAdapter(pool);
  const service=new WarehouseForensicService(repository,processRuns);
  return {
    router:createWarehouseForensicRouter(service),
    service,
    readiness:()=>checkWarehouseForensicReadiness(pool),
  };
}
