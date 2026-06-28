import { Router } from "express";
import { Pool } from "pg";
import { ShipEngineApi } from "../providers/shipEngineApi";
import { ShipEngineRepository } from "../repositories/shipEngineRepository";
import { ShipEngineProfitProtectionEngine } from "../engines/shipEngineProfitProtectionEngine";
import { getShipEngineEnv } from "../config/shipEngineEnv";
import { verifyShipEngineWebhookSecret } from "../utils/shipEngineUtils";

export function buildShipEngineRoutes(db?: Pool, api = new ShipEngineApi()): Router {
  const router = Router();
  const env = getShipEngineEnv();
  const repository = db ? new ShipEngineRepository(db) : undefined;
  const intelligence = new ShipEngineProfitProtectionEngine();

  router.get("/health/shipengine/api-key", async (_req, res, next) => {
    try { res.json(await api.healthCheck()); } catch (e) { next(e); }
  });

  router.get("/shipping/shipengine/account/settings", async (_req, res, next) => {
    try { res.json(await api.accountSettings()); } catch (e) { next(e); }
  });

  router.get("/shipping/shipengine/carriers", async (_req, res, next) => {
    try { res.json(await api.listCarriers()); } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/addresses/recognize", async (req, res, next) => {
    try {
      const response = await api.recognizeAddress(req.body);
      await repository?.recordRecognition({ type: "ADDRESS", request: req.body, response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/addresses/validate", async (req, res, next) => {
    try {
      const response = await api.validateAddresses(req.body);
      await repository?.recordAddressValidation({ request: req.body, response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/shipments/recognize", async (req, res, next) => {
    try {
      const response = await api.recognizeShipment(req.body);
      await repository?.recordRecognition({ type: "SHIPMENT", request: req.body, response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/shipments", async (req, res, next) => {
    try { res.json(await api.createShipments(req.body)); } catch (e) { next(e); }
  });

  router.get("/shipping/shipengine/shipments/:shipmentId", async (req, res, next) => {
    try { res.json(await api.getShipment(req.params.shipmentId)); } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/rates", async (req, res, next) => {
    try {
      const response = await api.getRates(req.body);
      await repository?.recordRates({ request: req.body, response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/rates/estimate", async (req, res, next) => {
    try {
      const response = await api.estimateRates(req.body);
      await repository?.recordRates({ request: req.body, response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/labels", async (req, res, next) => {
    try {
      const response = await api.purchaseLabel(req.body);
      await repository?.recordLabel({ response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/labels/rates/:rateId", async (req, res, next) => {
    try {
      const response = await api.purchaseLabelWithRate(req.params.rateId, req.body);
      await repository?.recordLabel({ response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/labels/rate-shopper/:rateShopperId", async (req, res, next) => {
    try {
      const response = await api.purchaseLabelWithRateShopper(req.params.rateShopperId as any, req.body);
      await repository?.recordLabel({ response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.get("/shipping/shipengine/labels/:labelId", async (req, res, next) => {
    try { res.json(await api.getLabel(req.params.labelId, req.query)); } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/labels/:labelId/return", async (req, res, next) => {
    try {
      const response = await api.createReturnLabel(req.params.labelId, req.body);
      await repository?.recordLabel({ response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.put("/shipping/shipengine/labels/:labelId/void", async (req, res, next) => {
    try { res.json(await api.voidLabel(req.params.labelId)); } catch (e) { next(e); }
  });

  router.get("/shipping/shipengine/tracking", async (req, res, next) => {
    try {
      const response = await api.track(req.query);
      await repository?.recordTracking({ response });
      res.json(response);
    } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/tracking/start", async (req, res, next) => {
    try { res.json(await api.startTracking(req.body)); } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/tracking/stop", async (req, res, next) => {
    try { res.json(await api.stopTracking(req.body)); } catch (e) { next(e); }
  });

  router.get("/shipping/shipengine/webhooks", async (_req, res, next) => {
    try { res.json(await api.listWebhooks()); } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/webhooks", async (req, res, next) => {
    try { res.json(await api.createWebhook(req.body)); } catch (e) { next(e); }
  });

  router.post("/webhooks/shipping/shipengine", async (req, res, next) => {
    try {
      const secretValid = verifyShipEngineWebhookSecret(req.header("x-tcds-shipengine-secret"), env.SHIPENGINE_WEBHOOK_SECRET, env.SHIPENGINE_WEBHOOK_REQUIRE_SECRET);
      if (!secretValid) {
        res.status(401).json({ ok: false, error: "Invalid ShipEngine webhook secret." });
        return;
      }
      const id = await repository?.recordWebhook({ headers: req.headers, payload: req.body, secretValid });
      res.status(200).json({ ok: true, carrier: "SHIPENGINE", id });
    } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/pickups", async (req, res, next) => {
    try { res.json(await api.schedulePickup(req.body)); } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/manifests", async (req, res, next) => {
    try { res.json(await api.createManifest(req.body)); } catch (e) { next(e); }
  });

  router.post("/shipping/shipengine/intelligence/best-rate", async (req, res, next) => {
    try { res.json(intelligence.selectBestRate(req.body.rates ?? [], req.body.expectedMaxCost)); } catch (e) { next(e); }
  });

  return router;
}
