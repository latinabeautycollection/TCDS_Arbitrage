import { Router } from 'express';
import { ebayGet } from '../services/ebayRequestLayer';
import { EbayScopes } from '../services/ebayScopes';

const router = Router();

router.get('/probe/ebay/browse/:environment', async (req, res) => {
  try {
    const environment =
      req.params.environment === 'production' ? 'production' : 'sandbox';

    const data = await ebayGet(
      environment,
      '/buy/browse/v1/item_summary/search',
      [EbayScopes.PUBLIC],
      {
        q: 'laptop',
        limit: 3,
      },
      undefined,
      'EBAY_US',
      'application',
    );

    res.status(200).json({
      ok: true,
      environment,
      tokenMode: 'application',
      data,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown probe error',
    });
  }
});

export default router;
