import { Router } from "express";
import { Pool } from "pg";
import { FedExApi } from "../providers/fedexApi";
import { FedExRepository } from "../repositories/fedexRepository";
import { FedExDecisionEngine } from "../intelligence/fedexDecisionEngine";
import {
  fedexAddressValidateSchema,
  fedexRateShopSchema,
  fedexTrackingSchema,
  fedexWebhookBodySchema,
} from "../validators/fedexValidators";

export function buildFedExRoutes(db?: Pool, api = new FedExApi()): Router {
  const router = Router();
  const repo = db ? new FedExRepository(db) : undefined;
  const decisionEngine = new FedExDecisionEngine(api);

  router.get("/health/fedex/oauth", async (_req, res, next) => {
    try { res.json(await api.healthCheck()); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/address/validate", async (req, res, next) => {
    try { res.json(await api.validateAddress(fedexAddressValidateSchema.parse(req.body))); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/rates", async (req, res, next) => {
    try { res.json(await api.rates(req.body)); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/intelligence/decide", async (req, res, next) => {
    try { res.json(await decisionEngine.decide(fedexRateShopSchema.parse(req.body))); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/service-availability", async (req, res, next) => {
    try { res.json(await api.serviceAvailability(req.body)); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/shipments", async (req, res, next) => {
    try { res.json(await api.createShipment(req.body)); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/shipments/cancel", async (req, res, next) => {
    try { res.json(await api.cancelShipment(req.body)); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/tracking", async (req, res, next) => {
    try { res.json(await api.track(fedexTrackingSchema.parse(req.body))); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/notifications", async (req, res, next) => {
    try { res.json(await api.notifications(req.body)); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/proof-of-delivery", async (req, res, next) => {
    try { res.json(await api.proofOfDelivery(req.body)); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/returns/tag", async (req, res, next) => {
    try { res.json(await api.returnTag(req.body)); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/pickups/availability", async (req, res, next) => {
    try { res.json(await api.pickupAvailability(req.body)); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/pickups", async (req, res, next) => {
    try { res.json(await api.createPickup(req.body)); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/pickups/cancel", async (req, res, next) => {
    try { res.json(await api.cancelPickup(req.body)); } catch (error) { next(error); }
  });

  router.post("/shipping/fedex/claims", async (req, res, next) => {
    try { res.json(await api.claims(req.body)); } catch (error) { next(error); }
  });

  router.post("/webhooks/shipping/fedex", async (req, res, next) => {
    try {
      const payload = fedexWebhookBodySchema.parse(req.body ?? {});
      const id = repo ? await repo.saveWebhook({ headers: req.headers, payload }) : null;
      res.status(202).json({ ok: true, carrier: "FEDEX", id });
    } catch (error) { next(error); }
  });

  return router;
}
