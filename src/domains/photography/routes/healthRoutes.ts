import { Router } from 'express';
import type { Pool } from 'pg';
export function createPhotographyHealthRoutes(db: Pool) {
  const router = Router();
  router.get('/v2/health', (_req,res)=>res.json({ status:'ok', domain:'photography', version:'v2-green-tier1' }));
  router.get('/v2/ready', async (_req,res,next)=>{ try { await db.query('select 1'); res.json({ ready:true }); } catch(e){ next(e); } });
  router.get('/v2/metrics', async (_req,res,next)=>{ try { const q=await db.query(`SELECT (SELECT count(*) FROM arb.photo_processing_jobs WHERE status IN ('QUEUED','RETRY')) queue_depth, (SELECT count(*) FROM arb.photo_processing_jobs WHERE status='DEAD_LETTER') dead_letter_count, (SELECT avg(photo_set_quality_score) FROM arb.photo_set_assessments WHERE created_at > now()-interval '24 hours') avg_photo_quality_24h, (SELECT count(*) FROM arb.photo_review_queue WHERE review_status='QUEUED') review_queue_depth`); res.json(q.rows[0]); } catch(e){ next(e); } });
  return router;
}
