import { Router } from "express";
import type { Pool } from "pg";
import {
  ShippingDestinationModelEngine,
  type CarrierRateAdapter,
} from "../engines/shippingDestinationModelEngine";

export function buildShippingDestinationModelRoutes(db: Pool, adapter: CarrierRateAdapter): Router {
  const router = Router();
  const engine = new ShippingDestinationModelEngine(db, adapter);

  router.get("/shipping/destination-model/default", async (req, res, next) => {
    try {
      const destinations = await engine.getDefaultDestinations({
        destinationModelKey: String(req.query.destinationModelKey ?? ""),
        categoryKey: req.query.categoryKey ? String(req.query.categoryKey) : undefined,
        shipDate: req.query.shipDate ? String(req.query.shipDate) : undefined,
      });
      res.json({ destinations });
    } catch (error) {
      next(error);
    }
  });

  router.post("/shipping/destination-model/prepurchase-rate", async (req, res, next) => {
    try {
      const result = await engine.estimatePrePurchaseRate(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/shipping/destination-model/digital-twin", async (req, res, next) => {
    try {
      const result = await engine.simulateForDigitalTwin(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/shipping/destination-model/learn", async (req, res, next) => {
    try {
      const result = await engine.learnWeightsFromOrders(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/shipping/destination-model/prediction-event", async (req, res, next) => {
    try {
      const id = await engine.recordPredictionEvent(req.body);
      res.json({ id });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
