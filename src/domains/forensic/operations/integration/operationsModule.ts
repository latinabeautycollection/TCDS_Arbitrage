import type { Pool } from 'pg';
import { OperationsRepository } from '../repositories/operationsRepository';
import { OperationsService } from '../services/operationsService';
import { createOperationsRoutes } from '../routes/operationsRoutes';

export function createOperationsModule(pool:Pool) {
  const repository=new OperationsRepository(pool);
  const service=new OperationsService(repository);
  return {repository,service,router:createOperationsRoutes(service)};
}
