import { Router } from "express";
import { Pool } from "pg";
import { DhlApi } from "../providers/dhlApi";
import { DhlRepository } from "../repositories/dhlRepository";
import { DhlProfitProtectionEngine } from "../engines/dhlProfitProtectionEngine";
import { basicAuthMatches } from "../utils/dhlUtils";
import { getDhlEnv } from "../config/dhlEnv";

export function buildDhlRoutes(db?: Pool, api = new DhlApi()): Router {
  const router = Router();
  const env = getDhlEnv();
  const repository = db ? new DhlRepository(db) : undefined;
  const profitEngine = new DhlProfitProtectionEngine();

  router.get("/health/dhl/api-key", async (_req, res, next) => {
    try { res.json(await api.healthCheck()); } catch (e) { next(e); }
  });

  router.get("/shipping/dhl/tracking/:trackingNumber", async (req, res, next) => {
    try {
      const response = await api.track({ trackingNumber: req.params.trackingNumber, ...req.query });
      await repository?.recordTracking({ trackingNumber: req.params.trackingNumber, response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.post("/shipping/dhl/webhooks", async (req, res, next) => {
    try { res.json(await api.createWebhook(req.body)); } catch (e) { next(e); }
  });

  router.get("/shipping/dhl/webhooks", async (_req, res, next) => {
    try { res.json(await api.listWebhooks()); } catch (e) { next(e); }
  });

  router.get("/shipping/dhl/webhooks/:hookId", async (req, res, next) => {
    try { res.json(await api.getWebhook(req.params.hookId)); } catch (e) { next(e); }
  });

  router.put("/shipping/dhl/webhooks/:hookId", async (req, res, next) => {
    try { res.json(await api.updateWebhook(req.params.hookId, req.body)); } catch (e) { next(e); }
  });

  router.delete("/shipping/dhl/webhooks/:hookId", async (req, res, next) => {
    try { res.json(await api.deleteWebhook(req.params.hookId)); } catch (e) { next(e); }
  });

  router.get("/webhooks/shipping/dhl", async (_req, res) => {
    res.status(200).json({ ok: true, carrier: "DHL", message: "DHL webhook validation endpoint active." });
  });

  router.post("/webhooks/shipping/dhl", async (req, res, next) => {
    try {
      const valid = env.DHL_WEBHOOK_REQUIRE_BASIC_AUTH
        ? basicAuthMatches(req.header("authorization"), env.DHL_ECOMMERCE_WEBHOOK_USERNAME, env.DHL_ECOMMERCE_WEBHOOK_PASSWORD)
        : true;

      if (!valid) {
        res.status(401).json({ ok: false, error: "Invalid DHL webhook auth." });
        return;
      }

      const id = await repository?.recordWebhook({ headers: req.headers, payload: req.body, basicAuthValid: valid });
      res.status(200).json({ ok: true, carrier: "DHL", id });
    } catch (e) { next(e); }
  });

  router.post("/shipping/dhl/returns/label", async (req, res, next) => {
    try {
      const response = await api.createReturnLabel(req.body);
      await repository?.recordReturnLabel({ request: req.body, response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.get("/shipping/dhl/returns/label/:pickup", async (req, res, next) => {
    try { res.json(await api.getReturnLabel(req.params.pickup, req.query)); } catch (e) { next(e); }
  });

  router.get("/shipping/dhl/locations/find-by-address", async (req, res, next) => {
    try {
      const response = await api.findLocationsByAddress(req.query);
      await repository?.recordLocationSearch({ searchType: "ADDRESS", request: req.query, response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.get("/shipping/dhl/locations/find-by-geo", async (req, res, next) => {
    try {
      const response = await api.findLocationsByGeo(req.query);
      await repository?.recordLocationSearch({ searchType: "GEO", request: req.query, response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.get("/shipping/dhl/locations/:locationId", async (req, res, next) => {
    try { res.json(await api.getLocation(req.params.locationId)); } catch (e) { next(e); }
  });

  router.post("/shipping/dhl/freight/pricequote", async (req, res, next) => {
    try {
      const response = await api.freightPriceQuote(req.body);
      await repository?.recordFreightQuote({ request: req.body, response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.post("/shipping/dhl/freight/booking", async (req, res, next) => {
    try { res.json(await api.freightBooking(req.body)); } catch (e) { next(e); }
  });

  router.post("/shipping/dhl/intelligence/tracking-risk", async (req, res, next) => {
    try { res.json(profitEngine.scoreTracking(req.body.statusCode, req.body.status, req.body.daysSinceUpdate ?? 0)); } catch (e) { next(e); }
  });

  return router;
}
