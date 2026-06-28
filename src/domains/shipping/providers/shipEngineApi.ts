import { ShipEngineClient } from "./shipEngineClient";
import { getShipEngineEnv } from "../config/shipEngineEnv";
import { shipEngineRateShopperSchema, shipEngineRecognizeTextSchema, shipEngineTrackSchema, shipEngineValidateAddressesSchema, shipEngineWebhookSchema } from "../validators/shipEngineValidators";

export class ShipEngineApi {
  private readonly env = getShipEngineEnv();

  constructor(private readonly client = new ShipEngineClient()) {}

  healthCheck() { return this.client.healthCheck(); }

  accountSettings() { return this.client.get("/v1/account/settings"); }

  listCarriers() { return this.client.get("/v1/carriers"); }
  getCarrier(carrierId: string) { return this.client.get(`/v1/carriers/${encodeURIComponent(carrierId)}`); }
  getCarrierServices(carrierId: string) { return this.client.get(`/v1/carriers/${encodeURIComponent(carrierId)}/services`); }
  getCarrierPackages(carrierId: string) { return this.client.get(`/v1/carriers/${encodeURIComponent(carrierId)}/packages`); }
  getCarrierOptions(carrierId: string) { return this.client.get(`/v1/carriers/${encodeURIComponent(carrierId)}/options`); }

  recognizeAddress(input: unknown) {
    return this.client.put("/v1/addresses/recognize", shipEngineRecognizeTextSchema.parse(input));
  }

  validateAddresses(input: unknown) {
    return this.client.post("/v1/addresses/validate", shipEngineValidateAddressesSchema.parse(input));
  }

  recognizeShipment(input: unknown) {
    return this.client.put("/v1/shipments/recognize", shipEngineRecognizeTextSchema.parse(input));
  }

  createShipments(input: unknown) { return this.client.post("/v1/shipments", input); }
  listShipments(query: Record<string, unknown>) { return this.client.get("/v1/shipments", query); }
  getShipment(shipmentId: string) { return this.client.get(`/v1/shipments/${encodeURIComponent(shipmentId)}`); }
  updateShipment(shipmentId: string, input: unknown) { return this.client.put(`/v1/shipments/${encodeURIComponent(shipmentId)}`, input); }
  cancelShipment(shipmentId: string) { return this.client.put(`/v1/shipments/${encodeURIComponent(shipmentId)}/cancel`); }
  getShipmentRates(shipmentId: string, query: Record<string, unknown> = {}) { return this.client.get(`/v1/shipments/${encodeURIComponent(shipmentId)}/rates`, query); }

  getRates(input: unknown) { return this.client.post("/v1/rates", input); }
  getBulkRates(input: unknown) { return this.client.post("/v1/rates/bulk", input); }
  estimateRates(input: unknown) { return this.client.post("/v1/rates/estimate", input); }
  getRate(rateId: string) { return this.client.get(`/v1/rates/${encodeURIComponent(rateId)}`); }

  purchaseLabel(input: unknown) { return this.client.post("/v1/labels", input); }
  purchaseLabelWithRate(rateId: string, input: unknown) { return this.client.post(`/v1/labels/rates/${encodeURIComponent(rateId)}`, input); }
  purchaseLabelWithShipment(shipmentId: string, input: unknown) { return this.client.post(`/v1/labels/shipment/${encodeURIComponent(shipmentId)}`, input); }
  purchaseLabelWithRateShopper(rateShopperId: "best_value" | "cheapest" | "fastest", input: unknown) {
    return this.client.post(`/v1/labels/rate_shopper_id/${rateShopperId}`, shipEngineRateShopperSchema.parse(input));
  }
  getLabel(labelId: string, query: Record<string, unknown> = {}) { return this.client.get(`/v1/labels/${encodeURIComponent(labelId)}`, query); }
  getLabelByExternalShipmentId(externalShipmentId: string, query: Record<string, unknown> = {}) {
    return this.client.get(`/v1/labels/external_shipment_id/${encodeURIComponent(externalShipmentId)}`, query);
  }
  createReturnLabel(labelId: string, input: unknown) { return this.client.post(`/v1/labels/${encodeURIComponent(labelId)}/return`, input); }
  trackLabel(labelId: string) { return this.client.get(`/v1/labels/${encodeURIComponent(labelId)}/track`); }
  voidLabel(labelId: string) { return this.client.put(`/v1/labels/${encodeURIComponent(labelId)}/void`); }
  cancelLabelRefund(labelId: string) { return this.client.post(`/v1/labels/${encodeURIComponent(labelId)}/cancel_refund`); }

  track(input: unknown) {
    const parsed = shipEngineTrackSchema.parse(input);
    return this.client.get("/v1/tracking", parsed);
  }
  startTracking(input: unknown) { return this.client.post("/v1/tracking/start", undefined, shipEngineTrackSchema.parse(input)); }
  stopTracking(input: unknown) { return this.client.post("/v1/tracking/stop", undefined, shipEngineTrackSchema.parse(input)); }

  listWebhooks() { return this.client.get("/v1/environment/webhooks"); }
  createWebhook(input: unknown) { return this.client.post("/v1/environment/webhooks", shipEngineWebhookSchema.parse(input)); }
  getWebhook(webhookId: string) { return this.client.get(`/v1/environment/webhooks/${encodeURIComponent(webhookId)}`); }
  updateWebhook(webhookId: string, input: unknown) { return this.client.put(`/v1/environment/webhooks/${encodeURIComponent(webhookId)}`, input); }
  deleteWebhook(webhookId: string) { return this.client.delete(`/v1/environment/webhooks/${encodeURIComponent(webhookId)}`); }

  listServicePoints(input: unknown) { return this.client.post("/v1/service_points/list", input); }
  getServicePoint(carrierCode: string, countryCode: string, servicePointId: string) {
    return this.client.get(`/v1/service_points/${encodeURIComponent(carrierCode)}/${encodeURIComponent(countryCode)}/${encodeURIComponent(servicePointId)}`);
  }

  listPickups(query: Record<string, unknown>) { return this.client.get("/v1/pickups", query); }
  schedulePickup(input: unknown) { return this.client.post("/v1/pickups", input); }
  getPickup(pickupId: string) { return this.client.get(`/v1/pickups/${encodeURIComponent(pickupId)}`); }
  deletePickup(pickupId: string) { return this.client.delete(`/v1/pickups/${encodeURIComponent(pickupId)}`); }

  listManifests(query: Record<string, unknown>) { return this.client.get("/v1/manifests", query); }
  createManifest(input: unknown) { return this.client.post("/v1/manifests", input); }
  getManifest(manifestId: string) { return this.client.get(`/v1/manifests/${encodeURIComponent(manifestId)}`); }

  insuranceBalance() { return this.client.get("/v1/insurance/shipsurance/balance"); }
  addInsuranceFunds(input: unknown) { return this.client.patch("/v1/insurance/shipsurance/add_funds", input); }

  listWarehouses() { return this.client.get("/v1/warehouses"); }
  createWarehouse(input: unknown) { return this.client.post("/v1/warehouses", input); }
  getWarehouse(warehouseId: string) { return this.client.get(`/v1/warehouses/${encodeURIComponent(warehouseId)}`); }
}
