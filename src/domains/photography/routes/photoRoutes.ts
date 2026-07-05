import { Router } from 'express';
import type { Pool } from 'pg';
import { PhotoProcessRequestSchema, ReviewDecisionSchema } from '../validators/photoRequestValidator';
import { PhotoRepository } from '../repositories/photoRepository';
import { PhotoJobRepository } from '../repositories/photoJobRepository';
import { PhotoReviewRepository } from '../repositories/photoReviewRepository';
import { EnterpriseLedgerRepository } from '../repositories/enterpriseLedgerRepository';
import { PhotoProcessingService } from '../services/photoProcessingService';
export function createPhotoRoutes(db: Pool) {
  const router = Router(); const photoRepo = new PhotoRepository(db); const reviewRepo = new PhotoReviewRepository(db); const ledger = new EnterpriseLedgerRepository(db); const service = new PhotoProcessingService(photoRepo, reviewRepo, ledger); const jobs = new PhotoJobRepository(db);
  router.post('/v2/process', async (req,res,next)=>{ try { const body = PhotoProcessRequestSchema.parse(req.body); const result = await service.process(body.photos, { ...body.context, actorType:'api' }); res.json(result); } catch(e){ next(e); } });
  router.post('/v2/jobs', async (req,res,next)=>{ try { const body = PhotoProcessRequestSchema.parse(req.body); res.status(202).json(await jobs.enqueue(body)); } catch(e){ next(e); } });
  router.get('/v2/jobs/:jobId', async (req,res,next)=>{ try { res.json(await jobs.get(Number(req.params.jobId))); } catch(e){ next(e); } });
  router.get('/v2/candidates/:candidateId/photos', async (req,res,next)=>{ try { res.json(await photoRepo.listByCandidate(Number(req.params.candidateId))); } catch(e){ next(e); } });
  router.get('/v2/review/queue', async (req,res,next)=>{ try { res.json(await reviewRepo.listQueued(Number(req.query.limit ?? 50))); } catch(e){ next(e); } });
  router.post('/v2/review/:reviewId/decision', async (req,res,next)=>{ try { const body=ReviewDecisionSchema.parse(req.body); res.json(await reviewRepo.decide(Number(req.params.reviewId), body.decision, body.reviewerId, body.notes)); } catch(e){ next(e); } });
  return router;
}
