import express from 'express';
import { ListingGenerationService } from '../services/listingGenerationService';
import { ListingReviewService } from '../services/listingReviewService';
import { ListingPublishService } from '../services/listingPublishService';
import { getPool } from '../repositories/db';

const router = express.Router();
const generation = new ListingGenerationService();
const review = new ListingReviewService();
const publish = new ListingPublishService();

router.get('/health', (_req: any, res: any) => res.json({ ok: true, domain: 'listing', version: 'v3' }));
router.get('/ready', async (_req: any, res: any) => { await getPool().query('select 1'); res.json({ ok: true }); });
router.post('/drafts/generate', async (req: any, res: any, next: any) => { try { const id=Number(req.body.sourceListingNormalizedId); if(!id) return res.status(400).json({error:'sourceListingNormalizedId required'}); res.json(await generation.generateDraft(id, req.body.processRunId)); } catch(e){ next(e); } });
router.post('/drafts/:draftId/approve', async (req: any, res: any, next: any) => { try { res.json(await review.approve(Number(req.params.draftId), req.body.reviewedBy || 'api')); } catch(e){ next(e); } });
router.post('/drafts/:draftId/publish', async (req: any, res: any, next: any) => { try { res.json(await publish.publishDraft(Number(req.params.draftId))); } catch(e){ next(e); } });
export default router;
