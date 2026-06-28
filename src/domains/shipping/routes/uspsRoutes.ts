import { Router } from "express";
import crypto from "crypto";
import { Pool } from "pg";
import { UspsApi } from "../providers/uspsApi";
import { UspsProfitProtectionEngine } from "../intelligence/uspsProfitProtectionEngine";
import { UspsForensicClaimEngine } from "../intelligence/uspsForensicClaimEngine";
export function buildUspsRoutes(db?: Pool, api = new UspsApi()): Router {
  const router = Router();
  const profitEngine = new UspsProfitProtectionEngine(api);
  const claimEngine = new UspsForensicClaimEngine();
  router.get("/health/usps/oauth", async (_req, res, next) => { try { res.json(await api.healthCheck()); } catch (e) { next(e); } });
  router.post("/shipping/usps/address/standardize", async (req, res, next) => { try { res.json(await api.standardizeAddress(req.body)); } catch (e) { next(e); } });
  router.get("/shipping/usps/city-state", async (req, res, next) => { try { res.json(await api.cityState(req.query)); } catch (e) { next(e); } });
  router.post("/shipping/usps/zipcode", async (req, res, next) => { try { res.json(await api.zipcode(req.body)); } catch (e) { next(e); } });
  router.post("/shipping/usps/prices/base-rates/search", async (req, res, next) => { try { res.json(await api.baseRatesSearch(req.body)); } catch (e) { next(e); } });
  router.post("/shipping/usps/prices/base-rates-list/search", async (req, res, next) => { try { res.json(await api.baseRatesListSearch(req.body)); } catch (e) { next(e); } });
  router.post("/shipping/usps/prices/extra-service-rates/search", async (req, res, next) => { try { res.json(await api.extraServiceRatesSearch(req.body)); } catch (e) { next(e); } });
  router.post("/shipping/usps/prices/total-rates/search", async (req, res, next) => { try { res.json(await api.totalRatesSearch(req.body)); } catch (e) { next(e); } });
  router.post("/shipping/usps/prices/letter-rates/search", async (req, res, next) => { try { res.json(await api.letterRatesSearch(req.body)); } catch (e) { next(e); } });
  router.post("/shipping/usps/options/search", async (req, res, next) => { try { res.json(await api.shippingOptionsSearch(req.body)); } catch (e) { next(e); } });
  router.post("/shipping/usps/intelligence/decide", async (req, res, next) => { try { res.json(await profitEngine.decide(req.body)); } catch (e) { next(e); } });
  router.post("/shipping/usps/intelligence/claim-readiness", async (req, res, next) => { try { res.json(claimEngine.score(req.body)); } catch (e) { next(e); } });
  router.post("/shipping/usps/tracking", async (req, res, next) => { try { res.json(await api.tracking(req.body)); } catch (e) { next(e); } });
  router.post("/shipping/usps/tracking/:trackingNumber/notifications", async (req, res, next) => { try { res.status(202).json(await api.registerNotifications(req.params.trackingNumber, req.body)); } catch (e) { next(e); } });
  router.post("/shipping/usps/tracking/:trackingNumber/proof-of-delivery", async (req, res, next) => { try { res.status(202).json(await api.requestProofOfDelivery(req.params.trackingNumber, req.body)); } catch (e) { next(e); } });
  router.post("/webhooks/shipping/usps", async (req, res, next) => {
    try {
      const payload = req.body ?? {};
      const payloadHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      const trackingNumber = payload.trackingNumber || payload.tracking_number || payload.mailpieceId || null;
      if (db) {
        await db.query(
          `INSERT INTO arb.usps_raw_event_ingest (event_type, tracking_number, headers_json, raw_payload, payload_hash)
           VALUES ($1,$2,$3::jsonb,$4::jsonb,$5)
           ON CONFLICT (event_source, payload_hash)
           DO UPDATE SET processing_status='DUPLICATE'`,
          [payload.eventType || payload.type || null, trackingNumber, JSON.stringify(req.headers), JSON.stringify(payload), payloadHash]
        );
      }
      res.status(202).json({ ok: true, carrier: "USPS", payloadHash });
    } catch (e) { next(e); }
  });
  return router;
}
