import { Router, Request, Response } from 'express';

const router = Router();

function handle(kind: string) {
  return (req: Request, res: Response) => {
    console.log(`[shipengine:${kind}] received`, JSON.stringify(req.body));
    res.status(200).json({ ok: true, kind });
  };
}

router.post('/webhooks/shipengine/track', handle('track'));
router.post('/webhooks/shipengine/rate', handle('rate'));
router.post('/webhooks/shipengine/carrier', handle('carrier'));
router.post('/webhooks/shipengine/report', handle('report'));

export default router;
