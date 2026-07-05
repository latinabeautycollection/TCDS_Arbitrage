import { Router } from 'express';
import { CredentialHealthCheck } from '../auth/CredentialHealthCheck';
import { loadGeminiAuthConfig } from '../config/geminiAuthConfig';

export function createGeminiAuthHealthRoutes(): Router {
  const router = Router();
  router.get('/health/gemini', async (_req, res) => {
    const health = await new CredentialHealthCheck(loadGeminiAuthConfig()).run();
    res.status(health.healthy ? 200 : 503).json(health);
  });
  router.get('/ready/gemini', async (_req, res) => {
    const health = await new CredentialHealthCheck(loadGeminiAuthConfig()).run();
    res.status(health.healthy ? 200 : 503).json({ ready: health.healthy, ...health });
  });
  return router;
}
