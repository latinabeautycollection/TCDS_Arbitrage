import express from 'express';
import { EnterpriseListingPlatformService } from '../services/enterpriseListingPlatformService';
import { ExecutiveListingAnalyticsService } from '../analytics/executiveListingAnalyticsService';

export const enterpriseListingRoutes = express.Router();
const service = new EnterpriseListingPlatformService();
const analytics = new ExecutiveListingAnalyticsService();

enterpriseListingRoutes.post('/enterprise/generate/:sourceListingNormalizedId', async (req: any, res: any, next: any) => {
  try {
    const result = await service.generateEnterpriseDraft(Number(req.params.sourceListingNormalizedId), req.body?.processRunId);
    res.json({ ok: true, result });
  } catch (err) { next(err); }
});

enterpriseListingRoutes.get('/enterprise/analytics/snapshot', async (_req: any, res: any, next: any) => {
  try { res.json({ ok: true, snapshot: await analytics.getExecutiveSnapshot() }); }
  catch (err) { next(err); }
});
